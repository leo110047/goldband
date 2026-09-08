# Goldband Decisions

## 2026-08-09: Local Work Map Owns Tracker Collaboration State

Decision: keep the local `WorkMapStore` as the sole Work Map domain owner while
offering GitHub Issues and GitLab Issues as optional projections and
collaboration surfaces.

Implementation contract:

- Tracker mode defaults to `off`. Configuration stores provider, repository,
  labels, and dependency capability but no token; provider authentication stays
  with `gh` or `glab`.
- Provider-neutral projection code owns deterministic Markdown, versioned
  markers, digests, sync checkpoints, and typed external-change candidates.
  GitHub and GitLab wire types remain inside their adapters.
- Preview has no remote side effect. Publish requires the exact persisted
  preview digest, unchanged local revision and remote digest, and one explicit
  next step per native-approved invocation. Successful writes are checkpointed
  before readback; verification covers title, body, labels, state, markers, and
  relationships.
- External issue content is untrusted data. Projection rejects secret-shaped
  values and private user paths. Assignee, state, checkbox, and resolution
  changes become candidates. Only approved domain operations may
  call `WorkMapStore`; issue close and checkbox state never create verified or
  completed evidence. Approved assignee import can create only an analysis
  binding; code claims remain owned by the managed-worktree broker.
- Provider APIs do not provide a reliable distributed claim lock. Concurrent
  local or remote drift blocks mutation for explicit resolution; there is no
  last-write-wins fallback.

Failure signals:

- An issue edit directly changes Work Map JSON or advances a ticket to
  `verified` without Phase 2 evidence.
- Publish proceeds with a stale preview, local revision, remote digest, or
  without per-step native approval and readback.
- A credential, issue body, comment, private path, or environment value enters
  config, telemetry, logs, or projection evidence.
- Retry duplicates remote artifacts, partial failure loses its checkpoint, or
  GitHub and GitLab implement different shared semantics.
- A publish invocation executes more than its named step, or remote protected
  fields can change while an unchanged marker suppresses conflict detection.

Live-provider behavior remains unverified until separately authorized
disposable private repositories complete the recorded verification procedure.

## 2026-07-16: Repository Runtime Tests Require Bun 1.3.11 and Explicit Bootstrap

Decision: treat Bun 1.3.11 as the minimum supported Goldband Loop runtime and
make repository test setup an explicit, deterministic bootstrap step. The root
test entrypoint remains offline and non-mutating; it fails early with one
remediation command when declared dependencies, the Bun minimum, or retired
ignored host artifacts are not ready.

Implementation contract:

- `goldband-loop/package.json` owns the Bun minimum and exact package-manager
  version. Setup reads the minimum from that contract and rejects older Bun
  before build, cleanup, or install side effects.
- CI pins the same Bun release on every platform. macOS runs the focused real
  PTY/WebSocket test plus the workflow and complete free runtime suites.
- `npm run bootstrap:test` installs the root, `mcp/server`, and
  `goldband-loop` lockfiles with their package-native installers. It also
  removes entries from ignored legacy host skill roots only when the shared
  retired inventory or a managed marker proves Goldband ownership. The root
  `goldband` skill, unrelated entries, and unknown same-prefix skills remain.
- `npm test` performs an offline preflight and reports all missing prerequisites
  before starting the fail-fast suite runner. Focused `--suite` runs remain
  available for diagnostics without requiring unrelated package setup.

Assumptions:

- Bun 1.3.11 or newer preserves the verified macOS PTY and WebSocket behavior.
- `npm ci` and `bun install --frozen-lockfile` remain the authoritative clean
  installers for their respective lockfiles.
- The tracked retired-entry inventory remains the authoritative migration list;
  new managed entries carry an explicit marker instead of claiming a prefix.

Consequences:

- A checkout that only ran root `npm ci` now gets a precise MCP/Loop dependency
  error instead of failing later because nested `tsc` is absent.
- Developers run one explicit bootstrap after clone, lockfile changes, or
  installer migrations; ordinary test reruns do not access the network or
  silently rewrite the checkout.
- Bun 1.2.x is no longer advertised as supported. Environments pinned below
  1.3.11 must upgrade before setup or the full runtime suite.
- macOS CI takes longer because it now owns the same runtime confidence expected
  from Linux instead of validating only installer and Playwright setup paths.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Keep `engines.bun >=1.0.0` and patch only the two tests | The failures reproduce in Bun 1.2.21 but pass unchanged in 1.3.11; weakening the runtime tests would preserve a false support claim. |
| Let `npm test` install missing dependencies automatically | Makes a validation command networked and mutating, and hides checkout/bootstrap drift. |
| Convert the root package to mixed npm/Bun workspaces | Does not give npm authoritative ownership of the Bun lockfile and expands the packaging change beyond the failure. |
| Ignore legacy generated host artifacts in contract tests | Leaves removed public entrypoints on upgraded checkouts and makes installed state differ from clean state. |

Failure signals:

- A supported Bun release fails the focused macOS PTY/WebSocket round trip.
- CI, setup instructions, `packageManager`, and `engines.bun` name different
  Bun versions.
- `npm run bootstrap:test && npm test` fails on a clean supported checkout due
  to missing declared dependencies or ignored legacy artifacts.
- Cleanup removes the root `goldband` skill, unrelated host entries, or unknown
  same-prefix entries without a managed marker.

Revisit triggers:

- A newer Bun release is adopted after the same cross-platform suite passes.
- Bun documents a lower stable release with equivalent PTY/WebSocket behavior
  and the focused test verifies it on macOS.
- The repository adopts one package manager and lockfile owner for all nested
  packages, making the explicit multi-package bootstrap unnecessary.

## 2026-07-16: Managed Agent Worktrees Use an OS Sandbox and Brokered Finish

Decision: keep the public worktree interface to `goldband worktree create` and
`goldband worktree finish`. `create` opens the agent inside a host OS sandbox
where working files are writable but all Git metadata and the source worktree
are read-only. `finish` is the only Git-writing path and runs outside that
sandbox after the user exits the managed shell.

Implementation contract:

- Leases, locks, scratch indexes, checkouts, and finish evidence live under the
  canonical real path of the declared Goldband state root at
  `~/.goldband/worktrees/` by default. Every lease, policy, and validation path
  uses that same canonical root, including macOS `/var` to `/private/var`
  resolution and user-supplied symlink aliases.
- The lease records canonical repository, source branch/worktree, base commit,
  common Git directory, per-worktree Git directory, enforcement boundary, and
  evidence target. Control files are owner-only.
- `create` accepts only a clean source worktree on a normal branch, creates a
  detached worktree, creates no branch, and probes the boundary before exposing
  the interactive shell.
- macOS uses Seatbelt to deny writes to source/Git/control state and every
  recorded broker input. Linux uses a read-only root through bubblewrap. Both
  expose a separate writable agent scratch directory while broker scratch stays
  read-only to the agent. Unsupported platforms, missing runtimes, failed
  probes, and nested hosts that cannot establish the boundary fail closed
  instead of falling back to hook-only enforcement.
- Claude Code and Codex run inside the same inherited process boundary. Their
  PreToolUse adapters and the global `pre-commit` hook are early diagnostics,
  not authorization owners.
- The managed shell instructs Codex to use `--sandbox danger-full-access` and
  Claude Code to apply `sandbox.enabled=false`. This disables only the nested
  OS sandbox that macOS cannot reliably establish; ordinary permission prompts
  and hooks remain active, and neither setting can bypass the outer boundary.
- `finish` validates the lease/marker, unchanged branch/base, clean source,
  Git locks, detached managed HEAD, tracked/untracked changes, and ignored
  files. It also compares source ignored paths with the prepared candidate tree
  immediately before integration. A file/directory collision stops and
  preserves the worktree, so ignored source content cannot be overwritten or
  removed by `updateInstead`.
- A broker-owned temporary index and object directory create the candidate in
  lease scratch. A local `receive-pack` quarantines those objects, accepts only
  a fast-forward of the checked-out original branch, and updates its clean
  worktree. Failed receives do not promote the candidate into the source object
  store. The managed worktree is removed only after commit, tree, branch, and
  clean-worktree readback succeed.
- At `create`, the broker pins a canonical trusted Git executable, captures the
  user identity, resolves only source/common-Git-owned local config and hook
  paths, and records their digest. The outer OS policy makes that executable,
  Goldband runtime, source config/hooks, global Git config inputs, and installed
  launcher/runtime paths read-only to the agent.
- At `finish`, every broker Git subprocess uses the pinned executable and an
  allowlisted environment with isolated `HOME`/XDG config, ignored system and
  global Git config, fixed identity, trusted `PATH`, and explicit hook/fsmonitor
  settings. The local receiver additionally pins the source-owned `hooksPath`,
  rejects non-fast-forwards, and uses `updateInstead`. The client-side
  `pre-push` hook remains disabled; receiver-side hooks still run only from the
  recorded source-owned hook root.
- Integration and cleanup are recoverable states. Before durable integration,
  every failure preserves the worktree. After integration, the lease remains
  until cleanup and evidence persistence succeed. If the broker process stops
  after preparing a scratch candidate but before receive, the next `finish`
  discards that candidate and rebuilds it from the still-present worktree.

Assumptions:

- The user starts agents from the shell opened by `create` and runs `finish`
  only after exiting it.
- Seatbelt and bubblewrap continue to enforce restrictions on all descendants;
  a same-permission host user outside the sandbox is intentionally trusted.
- Source-branch movement and source-worktree edits are external concurrent
  changes and must stop, not merge heuristically.

Consequences:

- Direct `git commit`, `--no-verify`, absolute-path Git, scripts,
  `commit-tree`, `update-ref`, and index writes share one filesystem denial
  instead of depending on command parsing.
- Tests that need temporary files receive a lease-owned scratch directory.
  Tests needing arbitrary writes outside the worktree may fail and must not be
  granted Git metadata access as a workaround.
- A failed receive discards the scratch candidate and Git's receive quarantine,
  so the source repository gains neither an unreachable commit nor a temporary
  ref. The editable worktree remains available for retry.
- Windows installation can distribute the CLI, but `create` fails closed there
  until a verified native boundary is implemented.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| PreToolUse or `pre-commit` only | `--no-verify`, absolute Git paths, scripts, and plumbing commands bypass command-level checks. |
| chmod/ACL under the same user | The agent can restore permissions; it is not a durable authority boundary. |
| An environment-variable finish override | Agent-controlled environment is not authorization. |
| A normal task branch per worktree | Expands the public model and leaves refs the agent can mutate. |
| Automatic active-agent detection | Host session death is not reliable enough; the user explicitly starts finish. |

Failure signals:

- A boundary probe can write the `.git` pointer, worktree Git directory,
  common Git directory, source worktree, or lease-control state.
- A managed agent changes refs or index state with any Git executable or
  indirect script.
- A managed agent can modify the pinned Git executable, Goldband broker runtime,
  installed launcher/runtime, global Git config, or recorded source hook/config
  inputs after `create`.
- `finish` proceeds after source movement, dirty state, ignored files, Git lock
  contention, an ignored source/candidate collision, changed broker config,
  invalid marker/manifest, or failed readback.
- Claude and Codex installs expose different CLI or hook/runtime assets.

Revisit triggers:

- Codex or Claude exposes a stable host-owned broker API that can replace the
  inherited shell boundary without weakening it.
- Windows gains a verified filesystem sandbox with equivalent descendant and
  Git-metadata restrictions.
- Git gains an atomic worktree-aware transaction that can replace the current
  prepare/fast-forward/readback sequence.

## 2026-07-15: Installed Workflow Prompts Are Thin Manifest Contracts

Decision: generate every installed
`workflows/<capability>/<action>.workflow.md` from manifest-owned prompt contract
fields. Do not install generated legacy `SKILL.md` files as workflow prompts.

Implementation contract:

- Each capability owns concise relevant context, hard boundaries, and
  verification in `goldband.manifest.json`; the action description is its goal.
- `scripts/lib/workflow-contracts.mjs` validates and renders the prompt contract.
  Missing fields or prohibited shared boilerplate fail generation.
- `goldband-loop/generated/capability-actions.json` records `contractPath`.
  `goldband-loop/setup` installs only that path and fails when it is absent.
- Browser guidance is a separate on-demand manual selected by manifest-owned
  routing. It is not embedded in every workflow.
- The old per-workflow `SKILL.md`/`SKILL.md.tmpl`, resolver preamble, model
  overlays, and `sourceTemplate` field are retired. Programmatic runtime and
  installation both resolve the manifest-owned `contractPath`.
- Generator tests enforce a 2 KiB per-contract limit and 64 KiB aggregate limit.
  Clean-install tests compare installed content byte-for-byte with generated
  contracts and reject executable shell blocks or universal preamble sections.

Why:

- Current frontier models need a clear outcome and boundaries, not repeated
  onboarding, tool-selection scripts, telemetry prose, or writing-style manuals.
- Runtime-owned state and safety behavior should not be approximated by copying
  the same prose into every prompt.
- A small migration cleanup list lets setup remove Goldband-managed legacy
  entries without retaining their prompt sources or generator architecture.

## 2026-07-12: Remove the Unity-Specific Skill Pack

Decision: remove `skills/projects/unity/` and its installer surfaces completely.
Goldband keeps portable engineering workflows, but no longer owns or distributes
a Unity-specific project skill pack.

Implementation contract:

- `pack-unity` and `unity` are removed rather than retained as compatibility
  aliases; invoking either now follows the normal unknown-option failure path.
- Installer state, validation, examples, architecture inventory, and generated
  assets must not reference the removed pack.
- General C#, game, mobile, performance, testing, and architecture work may use
  portable skills. Reintroducing a Unity-specific capability requires a new
  product decision and complete installer and validation wiring.

## 2026-07-11: Rules Are Enforced by Independent Review

Decision: `rules/*.md` remains the policy-content source of truth. A
metadata-only `rules/manifest.json` selects applicable Rules for programmatic
code review. Each review reads the current Rule text once into an immutable
snapshot shared by its single core prompt and prompt telemetry. The next review
creates a fresh snapshot.

Implementation contract:

- `hooks/scripts/lib/rules-resolver.js` is a pure read-only resolver. It
  validates complete manifest coverage, applies manifest-owned group selectors,
  reads the current source text, and returns content hashes.
- Claude and Codex review use the same resolver contract. Generated plugin
  copies and installed adapters are projections, not independent policy owners.
- Review fails closed when the manifest is incomplete, a Rule is missing, or
  the Rules payload exceeds its explicit byte budget.
- Deterministic gates verify manifest coverage, review prompt injection,
  generated asset drift, and installed runtime dependencies.
- Codex materializes the review resolver at
  `~/.codex/review-runtime/rules-resolver.js`; this path is independent of
  whether `~/.codex/hooks` is a symlink or copied directory.
- Semantic properties such as single authoritative truth, dead code, islands,
  and architecture boundaries belong to independent code review. They are not
  approximated by regex style gates or writer self-attestation.
- PreToolUse and Stop do not load, classify, or audit Rules. Goldband does not
  infer workspace ownership from arbitrary shell commands and does not maintain
  writer leases or semantic completion receipts.

## 2026-07-06: App Surface Support Uses Shared Config or Separate Adapters

Decision: support app surfaces without rewriting the existing CLI setup paths.
Codex app support uses the same shared Codex config surfaces as Codex CLI, while
Claude app support uses a separate MCP-based adapter instead of Claude Code
settings or hooks.

Why:

- Codex app, Codex CLI, and the Codex IDE extension share agent configuration,
  skills, and MCP settings through Codex config layers.
- Codex plugins are useful for a portable subset: skills plus optional app/MCP
  integration. They do not replace the installer-managed full Codex setup.
- Claude Desktop and Claude web/mobile connector support are app surfaces, not
  Claude Code runtime surfaces. They need a local extension or remote MCP
  connector, not copied Claude Code hooks.
- Goldband Loop remains installer-managed. It is too broad for the portable app
  adapter contract.

Implementation contract:

- `scripts/sync-app-support-assets.mjs` generates `.codex-plugin/plugin.json`,
  `.agents/plugins/marketplace.json`, `plugin-assets/codex-plugin/`, the Claude
  Desktop extension source, the remote connector template, and
  `docs/reports/app-support-expected-assets.json`.
- `scripts/build-claude-app-adapters.mjs` builds the local
  `goldband-local-extension.mcpb` package from the generated Claude Desktop
  extension source.
- `scripts/check-app-support.mjs` verifies generated drift, Codex plugin shape,
  repo marketplace shape, Claude Desktop package buildability, remote connector
  template shape, wrapper fail-closed behavior, and wording boundaries.
- `install.sh status` reports Codex app shared-config readiness, Codex plugin
  package availability, Claude Desktop local extension package/readback, and
  Claude remote connector template/readback separately.

External facts checked on 2026-07-06:

- Codex manual documents that Codex app agents inherit the same configuration
  as IDE and CLI, and that MCP configuration lives in `config.toml`:
  https://developers.openai.com/codex/codex-manual.md
- Codex manual documents plugins as bundles for skills, app integrations, and
  MCP servers, with repo and personal marketplace support:
  https://developers.openai.com/codex/codex-manual.md
- Claude support docs document remote MCP custom connectors for Claude web,
  mobile, and Desktop:
  https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp
- Claude support docs document local MCP servers for Claude Desktop and link
  Desktop Extensions for `.mcpb` packaging:
  https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop

## 2026-07-06: Claude Plugin as Primary Claude Core Distribution

Decision: distribute goldband's core Claude Code surface through a local
`goldband@goldband` plugin, while keeping `install.sh` as the developer, Codex,
and Goldband Loop workflow-runtime path. Codex plugin distribution is possible
for a Codex-specific subset, but it is not the current full-setup path.

Why:

- Claude Code plugins can package commands, skills, hooks, and marketplace
  metadata, which matches the external-user core surface better than manual
  installer setup.
- Goldband Loop is a heavier runtime with Playwright/browser/iOS dependencies;
  it remains installer-managed and is explicitly out of plugin scope.
- Codex has a plugin ecosystem, but this Claude plugin packages Claude Code
  assets. A Codex plugin could package a portable subset such as skills, MCP
  config, or app/workflow integrations.
- Goldband's Codex full setup also manages host-level assets:
  `codex/config.toml`, `codex/requirements.toml`, `codex/rules/`,
  `codex/hooks.json`, `codex/hooks/`, `codex/profiles/`,
  `codex/permission-profiles/`, `codex/agents/`, and Goldband Loop runtime
  assets. Those remain installer-managed until a Codex-specific distribution is
  designed and verified.
- Do not present Codex plugin support as Claude/Codex plugin parity or as a
  replacement for `install.sh codex-full`.

Implementation contract:

- `scripts/sync-plugin-assets.mjs` is the only writer for generated plugin
  assets under `plugin-assets/claude-code-plugin/`.
- `.claude-plugin/marketplace.json` points Claude Code at the generated plugin
  root; the repo root is not installed as the plugin package.
- `docs/reports/plugin-expected-assets.json` is the machine-readable expected
  asset list used by both drift and clean-home verification.
- `scripts/check-plugin-distribution.mjs` validates generated artifact drift,
  temp-HOME plugin install, installed command/skill/hook lists, and verifies the
  plugin cache does not contain `goldband-loop/`.
- `install.sh status` reports plugin/installer duplicate assets and exits
  non-zero rather than presenting a mixed install as all green.

External facts checked on 2026-07-06:

- Claude Code plugin docs document plugin directories, manifests, commands,
  skills, hooks, MCP servers, and marketplaces:
  https://code.claude.com/docs/en/plugins-reference
- Claude Code plugin marketplace docs document `.claude-plugin/marketplace.json`
  and `claude plugin marketplace add ./` for local marketplace installation:
  https://code.claude.com/docs/en/plugin-marketplaces
- Codex manual documents Codex plugins as bundles for Codex skills, apps, and
  MCP servers, with local marketplace support:
  https://developers.openai.com/codex/codex-manual.md

## 2026-07-05: Telemetry v1 and OTLP Export Boundary

Decision: keep JSONL as the telemetry source of truth and add OTLP as an
offline export layer.

Why:

- Hook execution must stay fast, offline, and dependency-free.
- Existing rotation and retention behavior already belongs to JSONL storage.
- OTLP export can be retried, scheduled, or dry-run without changing hook
  behavior.

Implementation contract:

- `scripts/lib/telemetry-schema.cjs` owns the v1 normalizer and validator.
- `schemas/telemetry.v1.schema.json` is the JSON Schema documentation artifact.
- Claude and Codex adapters write `schema_version`, `run_id`, and `event_id` on
  every new usage event while preserving legacy `sessionId`.
- `scripts/export-telemetry-otlp.mjs` reads JSONL and emits OTLP/HTTP JSON. It
  is not installed as a default daemon and does not run from hooks.

Run ID priority:

1. Explicit `run_id` / `runId` from the event.
2. Host hook `session_id` / `sessionId`.
3. Host env: `CLAUDE_SESSION_ID` for Claude, `CODEX_SESSION_ID` for Codex.
4. `GOLDBAND_RUN_ID` for explicit caller-controlled export/test runs.
5. `GOLDBAND_RUN_ID_FILE` for a caller-provided per-session marker file.
6. Claude transcript path hash when present.
7. `unknown`.

Codex note: the current Codex manual documents hooks and supported lifecycle
events, but this implementation did not find a public manual section that
documents a stable hook input session field. Goldband therefore treats
`session_id`, `sessionId`, and `CODEX_SESSION_ID` as the local observed adapter
contract. If a session launcher can provide `GOLDBAND_RUN_ID_FILE`, Goldband
will read or create a durable UUID there. Without a stable input or marker file,
it falls back to `unknown` rather than inventing a process-local ID.

Dependency choice: do not add `@opentelemetry/*` packages in this phase. The
OTLP spec supports OTLP/HTTP payloads encoded as JSON protobuf, so the exporter
builds the small traces payload directly. This avoids adding a dependency tree
to a repo whose default install surface does not need exporter runtime code.

External facts checked on 2026-07-05:

- Claude Code hooks reference documents `session_id`, `transcript_path`,
  `cwd`, and `hook_event_name` in hook inputs:
  https://docs.anthropic.com/en/docs/claude-code/hooks
- Codex manual hooks section documents hooks, lifecycle events, config shape,
  and command hook behavior:
  https://developers.openai.com/codex/codex-manual.md
- OpenTelemetry OTLP spec 1.10.0 documents OTLP/HTTP JSON-encoded protobuf and
  `/v1/traces` as the default trace path:
  https://opentelemetry.io/docs/specs/otlp/
- OpenTelemetry GenAI semantic conventions have moved to
  `open-telemetry/semantic-conventions-genai` and are marked Development:
  https://github.com/open-telemetry/semantic-conventions-genai

## 2026-07-08: Knowledge Lifecycle Trust Boundary

Decision: keep curated knowledge as local markdown plus `index.json`, and make
automatic capture candidate-only until explicit review promotes it.

Why:

- Workflow evidence, hook telemetry, and telemetry miner output are useful raw
  signals, but they can include stale context, host-specific noise, or
  prompt-injection shaped text.
- Default recall feeds future agent context, so it must not treat unreviewed
  candidates as trusted rules.
- A second persistent store would make lifecycle and install behavior harder to
  verify across Claude, Codex, MCP, and workflow templates.

Implementation contract:

- Automatic capture writes `status: candidate` with a deterministic
  `<source_type>-<YYYYMMDD>-<hash8>` id based on source type, sanitized source
  pointer, and summary.
- Duplicate candidate ids are skipped and never overwrite a file that may have
  been manually edited.
- `goldband-knowledge-review` is the explicit review surface for list, show,
  promote, edit, retire, and graduate actions.
- Default CLI, resolver, and MCP recall use `status=active`; candidate recall
  requires explicit candidate review or `--status candidate`.
- Frontmatter carries `source_evidence`, `trust_level`, `reviewed_by`,
  `last_verified`, `staleness`, and `graduated_to`.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Auto-promote verified workflow findings | Too easy to turn host-specific or stale findings into future rules without human review. |
| Store knowledge in a vector database | Outside the local-first, inspectable first-party runtime boundary for this phase. |
| Merge learnings, telemetry candidates, and curated knowledge into one store | Blurs raw evidence, append-only memory, and reviewed knowledge lifecycles. |

Failure signals:

- Default recall returns candidate entries without explicit candidate status.
- Knowledge entries accumulate without review, graduation, or retirement.
- `install.sh status` claims host parity when a host only has advisory or CLI
  exposure.
- Sanitizer tests stop covering secret-shaped and instruction-like content.

## 2026-07-13: Capability Manifest and Model-Native Prompt Boundary

Decision: expose one capability-based interface, `$goldband <capability>
<action>`, with no aliases for historical workflow names. Keep capability and
policy metadata in `goldband.manifest.json`; generate registry, routing hints,
inventory, policy projection, router menu, and capability docs from it.

Prompt contract:

- Shared prompts contain only the goal, relevant context, hard boundaries, and
  verification that can change the result.
- The model owns semantic reasoning, decomposition, tool selection, and
  adaptation.
- Runtime owns routing, authorization, outward-facing and irreversible action
  gates, typed evidence, stop conditions, state, and observability.
- Browser instructions and workflow contracts are read on demand. They are not
  embedded in the root skill or repeated in every prompt.

Why:

- OpenAI's prompting guidance recommends starting from the desired result,
  adding only useful context and a few boundaries, and leaving room for the
  model to choose tools and adjust its approach.
- The old catalog duplicated names and policy across generated skills, hooks,
  registry code, inventory, and docs. Those copies drifted and consumed model
  context without adding deterministic enforcement.
- Keeping old aliases would preserve the duplicate public contract and prevent
  missing migrations from failing visibly.

Migration contract:

- Standard installs expose only `goldband`.
- Installer cleanup removes Goldband-managed historical skill entrypoints.
- Internal documents use `workflows/<capability>/<action>.workflow.md`.
- Unknown historical names fail; they never redirect silently.
- `node scripts/generate-goldband-surfaces.mjs --check` is the freshness gate.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Preserve every old name as an alias | Keeps the catalog and migration burden alive indefinitely. |
| Keep routing tables handwritten per host | Recreates drift between Claude, Codex, hooks, runtime, and docs. |
| Put every workflow and browser instruction in root `SKILL.md` | Pays the context cost before the instructions are relevant and over-constrains model-native reasoning. |

## 2026-07-13: CI Boundary Owners Must Verify Their Completion Contracts

Decision: deterministic infrastructure boundaries own their complete outcome.
Callers and tests must not compensate for an incomplete owner contract with
sleep calls, partial spot checks, or undeclared tool dependencies.

Implementation contract:

- `process-supervisor.mjs` does not resolve forced termination until the whole
  process group is gone or a bounded cleanup verification fails explicitly.
- Codex high-risk shell policy separates unquoted shell command boundaries
  before command-local flags and targets are classified. Cross-command flag
  leakage is never treated as evidence of a destructive command.
- `check-codex-portability.sh` uses only declared baseline dependencies. Missing
  inputs and scanner errors fail closed with a distinct infrastructure error.
- `generated/capability-actions.json` owns the complete installed workflow
  document set. Clean-install verification compares the exact projection for
  both Claude and Codex instead of checking one representative file.
- Workflow installs record the canonical source path together with a contract
  fingerprint derived from the capability contract and its projection logic.
  `install.sh status` verifies against that same source, reports drift even when
  the human-readable version did not change, and fails explicitly when the
  recorded source is no longer available.

Assumptions:

- POSIX process groups remain the process-tree authority on macOS and Linux;
  Windows continues to use `taskkill /T`.
- The shell hook is a conservative lexical policy adapter, not a general shell
  interpreter. Compound rules that intentionally span a pipe remain explicit.
- `cksum`, `awk`, and `grep` are available in supported installer and CI shells.

Consequences:

- CI failures identify the owning boundary: cleanup, policy classification,
  portability scanning, or install projection.
- Forced process cleanup can take up to the bounded confirmation window before
  returning, and a surviving tree becomes an explicit failure.
- Changing workflow projection logic makes existing installs stale until the
  relevant workflow installer is rerun.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Add a delay to the flaky descendant test | Moves lifecycle responsibility into consumers and remains timing-dependent. |
| Allow the hook false positive manually | Leaves the classifier structurally unable to distinguish command boundaries. |
| Install `rg` in CI only | Keeps an unnecessary undeclared dependency in a baseline portability gate. |
| Check only `review/code.workflow.md` and the version marker | Cannot detect partial or same-version stale installs. |

Failure signals:

- A supervisor result returns while `process.kill(pid, 0)` still succeeds for a
  descendant in the supervised group.
- Safe adjacent shell commands can combine their flags into a denial.
- A missing portability scanner or input still prints `[OK]`.
- `install.sh status` reports green for a legacy flat workflow layout.
- A runtime installed through `GOLDBAND_LOOP_DIR` is compared against a
  different repository, or its missing recorded source is silently ignored.

Revisit triggers:

- Supported platforms provide a stronger native process-tree completion API.
- Shell policy expands to constructs that require a maintained parser rather
  than the current bounded lexical adapter.
- Workflow projections move out of `goldband-loop/setup` into a standalone
  materializer with its own stable contract version.

## 2026-07-13: Hooks Emit Only for Actionable Runtime Decisions

Decision: hook output is reserved for an enforcement decision, a state
transition that requires attention, or advice tied to the current action.
Generic workflow reminders and durable engineering policy stay in workflow
entrypoints, skills, and repository instructions instead of lifecycle hooks.

Implementation contract:

- `SessionStart`, `SessionEnd`, `PreCompact`, `PostCompact`, and generic
  `PostToolUseFailure` reminders are not registered and emit no output when
  evaluated directly.
- Hook events with no implementation are not registered merely to display a
  status message.
- Context restore remains an explicit Goldband workflow. Starting or resuming
  an unrelated session does not imply that restoration is needed.
- Prompt routing requires a capability-specific trigger. Generic words such as
  `檢查` do not activate review guidance by themselves.
- Context saturation guidance is emitted once when entering warning severity
  and once when entering critical severity, not every fixed number of calls.
- Ordinary `Stop` events do not produce desktop notifications or repeat style
  scans. Permission and elicitation notifications, immediate edit advisories,
  and deterministic stop blockers remain active.

Assumptions:

- Hosts already preserve their own session and compaction continuity.
- Durable verification policy is loaded through system, repository, and skill
  contracts, so repeating it on the first prompt adds noise rather than safety.
- A silent allow outcome is distinguishable from a failed hook through exit
  status and existing verification tests.

Consequences:

- New sessions and compaction transitions stay quiet unless a real decision is
  required.
- Hook authors must justify output against an explicit action or state change.
- Users invoke context restore when resuming handoff-sensitive work instead of
  receiving the reminder in every session.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Deduplicate generic reminders once per session | Still interrupts unrelated sessions and requires persistent marker state for no runtime decision. |
| Keep all reminders but shorten their text | Reduces message size without fixing frequency or ownership. |
| Disable every advisory hook | Removes useful permission, safety, and action-specific feedback together with the noise. |

Failure signals:

- Starting, resuming, compacting, or ending an otherwise idle session injects
  Goldband guidance.
- A generic request containing `檢查` suggests an unrelated review workflow.
- Warning-level context monitoring repeats without a severity transition.
- An ordinary assistant stop produces a desktop notification or repeats a
  repository-wide style advisory.

Revisit triggers:

- A host stops preserving required state across resume or compaction and the
  failure cannot be solved at the state owner.
- A lifecycle transition gains a concrete user decision or deterministic
  enforcement contract that cannot be expressed elsewhere.

## 2026-07-16: Capability Surface Requires Proven Runtime Ownership

Decision: reduce the formal capability inventory from 51 actions to 23. Expose
19 public actions and retain four high-risk actions only as hidden experimental
inventory. A runnable action must declare one runtime owner in the manifest;
an experimental action cannot claim an owner.

Implementation contract:

- Remove 28 overlapping action names instead of preserving aliases. Their
  useful behavior becomes a mode, lens, command, or stage of the remaining
  review, plan, browser, document, safety, and iOS owners.
- Generated routing and activation hints contain only public actions.
  Experimental actions remain in the engineering inventory and thin contract
  projection, but are not discoverable or runnable.
- Typed owner steps validate structured input, write JSONL evidence, persist
  state atomically where state exists, and return explicit completed or blocked
  readback.
- Compatibility actions remain mock-only and fail closed in real mode.
- High-risk work cannot hide outward side effects inside a workflow child
  process. In particular, `system/upgrade` owns preflight and readback while the
  host's native tool and approval layer owns `git pull` and setup execution.

The resulting inventory is 15 typed, four compatibility, and four experimental
registered-only actions. The experimental set is `release/land`,
`release/setup`, `knowledge/setup`, and `knowledge/sync`.

Why:

- A prompt contract and formal name are not runtime capability. Without an
  owner, validated state, evidence, and a stop condition, the interface
  overstates product maturity.
- Separate lifecycle from runtime maturity. This keeps high-risk work visible
  to maintainers without advertising unfinished operations to users.
- Folding lenses and phases into stable owners reduces routing ambiguity and
  migration cost while preserving the underlying behavior.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Keep all 51 actions and label 46 experimental | Leaves the oversized public vocabulary and duplicate ownership model intact. |
| Change only manifest runtime labels | Produces typed-looking entries with no action-specific validation, state, or evidence owner. |
| Preserve removed actions as compatibility aliases | Violates the no-alias capability decision and keeps old contracts alive indefinitely. |
| Let `system/upgrade` run `git pull` after an input boolean | A JSON field is not native host approval and would hide an outward side effect inside Bun. |

Failure signals:

- Router or activation output contains an experimental action.
- A runnable manifest action has no owner, or a registered-only action claims
  one.
- Removed action names return through active documentation or generated
  contracts.
- A typed owner accepts malformed real-mode input, writes non-atomic state, or
  reports completion without readback evidence.
- High-risk runtime code executes a network, release, setup, or sync side
  effect behind the host permission boundary.

Revisit triggers:

- Release obtains a deployment-neutral approval, rollback, and readback owner.
- GBrain setup and sync obtain secret-safe interaction schemas plus resumable
  checkpoint and round-trip verification contracts.
- Compatibility actions gain action-specific typed schemas and real-mode
  evidence.

## 2026-07-16: Runtime Completion Must Reflect Effective Host State

Decision: host-scoped workflows may report completion only after reading back
the state that the host actually consumes. Public menus are generated per host,
and runtime invocation independently enforces manifest `hostSupport`.

Implementation contract:

- `safety/guard`, `safety/freeze`, and `safety/unfreeze` are Claude-only and
  delegate to the existing session-scoped careful-mode and freeze-mode owner.
  Completion requires owner readback; an actual PreToolUse `Edit` regression
  test proves freeze enforcement.
- `system/health` inspects the selected host's installed runtime under `HOME`,
  including required files, `.installed-source`, `.installed-contract`, and
  source/install fingerprint drift. Source checkout health is not installation
  health.
- `plan/create` remains Claude-only. Codex menus, hints, and planner guidance do
  not advertise it, while runtime rejects a Codex invocation.
- `document/generate` owns a typed `audit` mode with required unified-diff input,
  deterministic coverage and PR-section artifacts, and a native approval gate
  for PR mutation. The workflow does not generate documentation or mutate PRs.
- Context checkpoint indexes include repository/worktree identity and branch;
  restore selects the current branch's latest checkpoint.
- Active-document tests validate local Markdown link targets, not only
  capability invocation strings.

Failure signals:

- A safety action is completed while the corresponding hook decision still
  allows the protected operation.
- An empty or stale installed runtime passes `system/health` because source
  files are healthy.
- A host menu advertises an action excluded by its manifest `hostSupport`.
- Documentation audit mutates a PR without native approval or claims it wrote
  docs that it only analyzed.
- Saving branch B makes branch A's latest checkpoint unreachable.

## 2026-07-16: High-Risk Operations Require Verifiable Runtime Gates

Decision: keep one manifest-owned safety contract for each of the nine
high-risk operations identified before capability convergence. A retired action
name may remain only as an internal operation ID mapped to its active action and
mode; it does not become a public route or compatibility alias.

Implementation contract:

- `release/land`, `release/setup`, `release/canary`, `browser/cookies`,
  `knowledge/setup`, `knowledge/sync`, `system/upgrade`, `ios/qa`, and
  `ios/sync` each declare authorization, preconditions, side effects, readback,
  enforcement state, and gate owner in `goldband.manifest.json`.
- Every high-risk action must have a primary gate. Nested high-risk modes on a
  lower-risk action require their own operation gate.
- A registered-only action cannot declare `runtime-owner` enforcement. A
  runtime-owned gate must match the action's declared runtime owner.
- `blocked-before-runtime` is executable policy: browser cookie commands and
  the iOS sync mode stop during runtime admission before an owner step runs.
- `system/upgrade` and read-only `ios/qa` have operation-specific verifiers.
  Definition fails when their declared preconditions, side effects, readback,
  authorization, or owner drift from the implemented verifier contract.
- Runtime input validation happens before the owner. A gate writes successful
  `verified` evidence only after the owner output and trusted artifact satisfy
  every declared readback. A blocked or mock-only owner writes `pending` with
  `skipped` status, never successful gate evidence.
- `ios/qa` requires an explicit project, scheme, device scope, and supplied QA
  checks. It never fabricates mock passing evidence and reports untested device
  coverage in the trusted QA artifact.
- `system/upgrade` requires an explicit preflight or readback phase. Preflight
  remains pending through native approval; only a matching completed preflight,
  version/head transition, and setup readback can verify the gate.
- Generated capability contracts and documentation include the safety
  inventory so installer fingerprints and source checks detect drift.

Why:

- A prompt instruction to ask for approval is not an enforcement boundary.
- Restoring removed action aliases would undo capability convergence, while
  forgetting their risk contracts would make future modes easier to integrate
  unsafely.
- Owner identity alone is not safety evidence. Contract inputs, owner output,
  provenance-bound artifacts, and readback must agree before verification.

Failure signals:

- A high-risk action has no primary gate or two actions claim the same safety
  operation.
- A registered-only operation claims an owner or becomes runnable.
- Cookie import or iOS synchronization reaches an owner step while its gate is
  blocked.
- A typed high-risk action records `verified` before its declared readback is
  validated, or a blocked/mock execution records successful gate evidence.
- A runtime-owner gate declares a contract item its operation-specific verifier
  does not implement.
- Retired operation IDs reappear in generated menus or routing hints.

Revisit triggers:

- A blocked operation gains a typed owner that implements every declared
  precondition, authorization boundary, side effect, and readback requirement.
- A high-risk operation is removed entirely rather than retained as a mode of
  an active action.

## 2026-07-20: Interactive Review Must Enter the Typed Runtime

Decision: an interactive Codex or Claude `$goldband review code` invocation
must launch the executable review owner before reporting findings. The thin
workflow contract selects the runtime; it does not perform a second manual
review in the parent agent.

Implementation contract:

- `bin/goldband review code --host <codex|claude>` is the public launcher. It
  forces real mode and defaults to the whole current worktree when the user
  does not name a narrower scope.
- The launcher resolves `workflows/run.ts` from the active source root or the
  installed runtime's `.installed-source`; missing runtime ownership fails
  explicitly.
- User-supplied prompt text never proves runtime ownership. The launcher marks
  the child environment with `GOLDBAND_REVIEW_ACTIVE`, and nested launchers fail
  before starting another runtime or host.
- The launcher probes the evidence root before starting. If the default
  `~/.goldband` root is blocked by the caller's filesystem sandbox, it uses a
  private temporary state root and reports the evidence as ephemeral. An
  explicitly configured state root remains fail-closed when it is not writable.
- The installed Codex launcher has an exact machine-local allow rule. Missing
  launcher, runtime, or rule is an install failure rather than a request for
  ad-hoc escalation. The child remains read-only with approval set to `never`.
- Codex subprocesses use `--ask-for-approval never` with the read-only sandbox.
  Command approval and mutating capability are removed by the host adapter, not
  by child prompt prose.
- Codex reviewers also use `--ignore-user-config`, an explicit empty
  `mcp_servers` override, and `--ephemeral`. Authentication still comes from
  `CODEX_HOME`, but user/project customization cannot expose external MCP tools
  or persist a reviewer session.
- Claude subprocesses use `--safe-mode` plus a read-only tool allowlist so
  repository or user hooks, plugins, MCP servers, and other executable
  customizations cannot create side effects. The prompt tells the reviewer to
  inspect applicable `AGENTS.md` and `CLAUDE.md` files explicitly with read-only
  tools because safe mode disables their automatic loading.
- Review input is bounded to 2 MiB. Git collection uses an explicit larger
  process buffer and converts overflow into a scope-narrowing error instead of
  leaking the host runtime's `ENOBUFS` failure.
- Review scope is validated by one shared contract at both the public launcher
  and typed runtime boundary. `--base --worktree` is the only valid combined
  primary scope; `--include-untracked` is a modifier but cannot be combined
  with `--diff-file`, which is already a complete supplied artifact.
- Complete-pass deadlines use `performance.now()` from pass creation through
  every Git and host timeout. Wall-clock timestamps remain evidence metadata
  only, so system-clock changes cannot extend the runtime budget.
- Untracked paths are collected with `git ls-files -z` and parsed on NUL
  boundaries. Legal filenames containing newlines, tabs, quotes, or backslashes
  therefore reach the same containment and content checks as ordinary paths.
- The single core prompt is delivered over child stdin, never as a command
  argument. The full 2 MiB input contract therefore does not depend on the host
  operating system's smaller `ARG_MAX` limit.
- `--diff-file` and untracked-file collection accept only stable regular files.
  They reject symbolic links and special files, validate the opened inode, and
  read through that same no-follow file descriptor. Descriptor metadata is
  checked again after the final read so pathname swaps and same-inode writes
  both fail closed instead of producing mixed review input.
- An automatic launcher or runtime failure is terminal. The parent agent must
  not silently fall back to an untyped manual review or claim complete
  coverage.
- Ordinary review keeps automatic specialist selection. A strict or exhaustive
  request explicitly adds `--specialists all`, whose incomplete coverage fails
  closed.
- A real host call defaults to twelve minutes. A complete review pass is bounded
  to twelve minutes with specialists off, twenty minutes in auto mode, and
  thirty minutes only for explicit `--specialists all` coverage. Validated CLI
  overrides may narrow or extend those budgets within 60 to 1800 seconds; the
  host-call timeout cannot exceed the pass timeout.

Assumptions:

- Codex and Claude continue to honor selected skill contracts and can execute
  the installed `bin/goldband` launcher.
- The workflow installer keeps `.installed-source` authoritative for copied
  minimal runtimes.
- Real host review remains read-only and structured through the existing host
  adapters.

Consequences:

- Interactive review now uses deterministic diff collection, typed finding
  validation, runtime evidence, and the selected specialist policy.
- A normal review invocation may take longer and consume additional host model
  calls; exhaustive specialist review costs more and remains explicit.
- Normal auto reviews fail within a bounded twenty-minute pass instead of silently
  inheriting the exhaustive thirty-minute ceiling. Timeout telemetry makes
  later tuning evidence-driven rather than another hard-coded guess.
- An optional auto specialist reaching the pass deadline degrades to a recorded
  coverage diagnostic while preserving completed core findings. Explicit
  exhaustive coverage still fails closed when any specialist is incomplete.
- Hosts outside Codex and Claude continue to use their supported prompt path
  until they gain a real typed adapter.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Keep the thin skill as a manual checklist | Leaves runtime entry, scope, evidence, and specialist dispatch dependent on model discretion. |
| Launch the runtime from a prompt-routing hook | Generic review hints can fire for explanatory questions and are not the owner of long-running model subprocesses. |
| Put a raw `bun workflows/run.ts` command in every installed contract | Couples prompt surfaces to source layout and breaks copied minimal runtimes. |
| Silently fall back when the launcher fails | Produces a review that looks complete without typed runtime evidence. |
| Keep one two-minute timeout for every mode | The measured real Codex pass exhausted it before producing findings, while it provided no whole-pass budget for specialist fan-out. |
| Give every review a thirty-minute timeout | Makes ordinary review stalls too slow to diagnose and hides prompt or dispatch regressions. |

Failure signals:

- `$goldband review code` returns findings without a real-host runtime report or
  artifacts.
- A runtime-owned reviewer starts another `goldband review code` process.
- A copied installation cannot resolve the executable workflow source.
- Launcher failure is followed by an untyped manual approval.
- Auto review approaches its twenty-minute deadline or repeatedly exhausts the
  twelve-minute host-call budget.

Revisit triggers:

- Codex or Claude provides a native skill-to-executable binding that removes
  the need for a prompt-directed launcher.
- A host supports typed review directly without spawning its CLI adapter.
- Measured cost or latency justifies a different default specialist policy.
- At least twenty comparable real-host runs provide a stable latency
  distribution that justifies replacing the initial timeout budgets.

## 2026-07-21: Codex Config Freshness Follows Key Ownership

Decision: treat the generated Codex config as a shared file with key-level
ownership. Goldband requires every key/value emitted by `codex/config.toml` and
`codex/local/config.toml` to remain present with the expected value, but it does
not claim additional keys or tables written by Codex App. Host-maintained
`marketplaces.*.last_updated` values are explicitly volatile and excluded from
freshness comparison.

Implementation contract:

- `is_current_generated_codex_config` keeps the generated header as the file
  identity check, validates the complete installed file with Python `tomllib`,
  then compares a deterministic projection of Goldband-owned TOML records
  instead of comparing the complete file text.
- Missing Python 3.11+ `tomllib` support makes syntax health `unverifiable` and
  exits `2`; syntax validation never degrades to a permissive text scan.
- Additional root keys, table keys, MCP servers, plugins, and desktop settings
  are allowed because absence from Goldband source means Goldband does not own
  them.
- Missing or changed Goldband-owned records still report `stale` and make
  `install.sh status` exit `2`.
- Every Goldband-owned table/key must occur exactly once; duplicate managed
  keys fail closed even when one duplicate retains the expected value.
- Codex profile files retain their stricter source comparison because they are
  policy artifacts, not shared App configuration. Only their declared runtime
  state sections are excluded.
- App-support status reuses the same freshness predicate; it does not maintain
  a second ownership policy.

Assumptions:

- Goldband's generated main config continues to use single-line TOML
  assignments for owned values.
- A Python 3.11+ entrypoint is available as `python3`, `python`, or Windows
  `py -3` when a green config health verdict is required.
- Codex App may add or reorder valid TOML content but does not remove or rewrite
  Goldband-owned values without creating meaningful drift.
- Marketplace update timestamps remain host-maintained metadata rather than
  Goldband policy.

Consequences:

- Codex App integrations can evolve without causing false stale status or
  encouraging users to overwrite working App configuration.
- Invalid installed TOML is reported separately from source drift, before any
  ownership comparison can return `[OK]`.
- Goldband still detects policy drift in models, approvals, sandboxing,
  features, agents, local project trust, and other source-declared values.
- New multiline Goldband-owned values require extending the projection parser
  and its regression coverage before they can be used safely.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Keep whole-file comparison and enumerate every App-generated block to strip | Couples Goldband to volatile App implementation details and recreates false positives whenever the App adds a field. |
| Treat the generated marker as sufficient | Misses real changes to Goldband-owned policy. |
| Reinstall the repo config whenever App content appears | Can erase valid MCP, plugin, browser, Computer Use, and desktop state. |
| Copy current App additions into `codex/local/config.toml` | Freezes volatile host state into repo-local policy and still drifts on later App updates. |
| Treat lines with no `=` as invalid in the AWK projection | Catches one malformed shape but still misses duplicate keys, malformed arrays, strings, and other TOML syntax errors. |

Failure signals:

- `install.sh status` reports stale after Codex App only adds or reorders keys.
- Invalid installed TOML is reported `[OK]` or is reduced to ordinary managed
  drift instead of the explicit `invalid` state.
- A changed or missing Goldband-owned key still reports `[OK]`.
- A profile policy change is ignored as if it were App-owned state.
- An owned multiline TOML value is introduced without a parser/test update.

Revisit triggers:

- Codex provides a documented native split between user policy and App runtime
  state files.
- Goldband adopts a portable TOML parser as an installer dependency.
- Codex App begins rewriting Goldband-owned keys semantically without preserving
  their textual value representation.

## 2026-07-21: Review Impact Graph Is Parent-Runtime Infrastructure

Decision: Goldband owns a bounded, persistent file dependency-impact graph in
the typed `review/code` parent runtime. It is built only when at least two files
changed, before host dispatch, and is passed to the single core prompt as
advisory inspection context. It is not an MCP server, child-reviewer plugin, or
independent source of findings.

Implementation contract:

- Git-backed `collect-diff` scopes emit exact changed paths alongside the
  authoritative diff; supplied patch artifacts derive paths from file headers.
- One changed file returns `skipped: single-file` before repository inventory or
  graph-cache access. Zero paths and changes without supported source types have
  separate explicit skip reasons.
- Multi-file review inventories Git-tracked files plus reviewed changed paths,
  parses bounded regular source files without following symlinks, resolves
  common local dependency forms, and walks reverse impact to depth two.
- The cache is stored under Goldband state, keyed by the real repository root,
  validated on load, updated atomically, and reused by file identity and
  metadata signature. It never modifies the reviewed repository.
- Graph status is `analyzed`, `degraded`, or `skipped`. Limits and unreadable or
  unstable inputs become diagnostics rather than silently implying complete
  coverage.
- The core prompt treats graph output as structural hinting only. The diff
  remains complete review scope, and a blocking finding still requires current
  source evidence and a reachable failure path.
- Missing observed test dependencies and wide or truncated impact remain
  deterministic signals in the core review context; they do not dispatch
  independent specialists.
- Each pass emits an impact JSON artifact and telemetry for skip reason, parsed
  and reused files, edges, affected files, tests, truncation, and diagnostics.

Assumptions:

- Common local import patterns provide useful prioritization without claiming a
  language-complete semantic graph.
- Git-tracked inventory is the safest default repository boundary; only
  untracked paths already admitted into the review diff may enter the graph.
- File metadata signatures are adequate for cache invalidation because a file
  is reread whenever identity, size, modification time, or change time differs.

Consequences:

- Multi-file review can inspect indirect consumers and likely test coverage
  earlier without giving child reviewers network, MCP, or persistent state.
- Single-file changes retain direct-review context efficiency and avoid a full
  repository scan.
- Unsupported languages, dynamic imports, aliases, generated wiring, and
  relationships beyond the depth/output bounds can be absent; that absence is
  never treated as proof of safety.
- The parent runtime now owns a cache and graph artifact lifecycle that must
  remain bounded, injection-safe, and covered by workflow tests.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Install the referenced graph MCP or parser stack into each reviewer child | Violates child isolation, adds external runtime dependencies, and duplicates persistent state across host adapters. |
| Run graph construction for every review | The repository scan can cost more context and latency than direct inspection for a one-file change. |
| Let graph reachability define review scope or findings | Static extraction is incomplete and would turn missing edges into false assurance. |
| Keep only an in-memory graph | Repeats repository parsing on every review and discards useful bounded reuse. |
| Use a language-complete parser immediately | Adds a large dependency and maintenance surface before Goldband has measured language-specific precision needs. |

Failure signals:

- A one-file review creates or reads the persistent graph index.
- A graph path is used to omit a changed diff path or to report a blocker
  without current source evidence.
- Ignored or unrelated untracked files enter the graph.
- Cache corruption, file churn, or repository size produces silent partial
  coverage instead of `degraded` evidence.
- Review latency or prompt size materially regresses on ordinary multi-file
  changes.

Revisit triggers:

- Real review telemetry shows graph construction or prompt overhead outweighs
  useful affected-path discovery.
- A supported language repeatedly misses high-value edges that require a proper
  parser or project configuration resolver.
- Measured repository scale requires incremental background indexing, a tighter
  bound, or an explicit opt-out.
- Host runtimes gain a trustworthy native dependency graph with equivalent
  isolation, bounds, and evidence semantics.

## 2026-07-21: Codex Workflows Use Installer-Owned Exact Admissions

Decision: supersede the parent-escalation clause of “Interactive Review Must
Enter the Typed Runtime” for Codex. A global Codex install materializes a
Goldband workflow launcher outside the active workspace and installs exact
machine-local `allow` rules for only that launcher’s `review code --host codex`
prefix and enumerated browser inspection commands. Interactive Codex runs those
trusted admissions normally and never asks for `require_escalated` approval.

Implementation contract:

- `goldband-loop/setup --host codex` bundles the public launcher and typed
  workflow owner, browser client, bundled browser server, Rules resolver, and
  an immutable Rules snapshot into
  `~/.codex/goldband/workflow-runtime`; these are real files, not links into the
  Goldband checkout.
- The installer records the absolute Bun and launcher paths in
  `~/.codex/skills/goldband/.workflow-launcher.json` and generates
  `~/.codex/rules/goldband-workflows.rules` from the same values.
- The snapshot records the installed Codex CLI by absolute path. The launcher
  removes caller-provided override state and the host adapter uses the pinned
  executable instead of resolving `codex` from the reviewed process `PATH`.
- The rules fix the Bun executable, materialized launcher, capability, action,
  `--host`, and `codex` argv prefix. Review scope and timeout suffixes remain
  available. Browser rules additionally fix an enumerated inspection command;
  navigation and wait commands do not match automatic admission.
- Codex CLI browser work always enters Goldband's browser owner. It never probes
  Codex App Browser/Chrome bindings. The owner admits navigation and inspection
  commands while rejecting outward-effect operations, but navigation remains
  on Codex's native approval path because it can reach localhost/private origins.
- The workflow reads and executes the installed marker exactly. It never
  substitutes `bin/goldband` from the current workspace or falls back to a
  manual review.
- Reinstall stages a complete snapshot, swaps the previous runtime to a backup,
  and restores it if activation fails. Status validates the same pinned Codex
  executable used by review and probes policy through that executable. Uninstall
  removes the snapshot and Goldband-owned rule.
- Missing or inconsistent launcher state fails closed with a reinstall
  instruction. A broader or more restrictive host/admin policy remains outside
  this contract and may still override the generated rule.

Assumptions:

- Codex continues to interpret an exact `allow` rule as permission to run the
  matching command outside the sandbox without prompting.
- The user trusts the Goldband installer to refresh its own runtime; reviewed
  repositories do not have write access to the installed snapshot or rule.
- The nested reviewer retains its existing read-only sandbox and `never`
  approval policy after the parent launcher is admitted.

Consequences:

- `$goldband review code` no longer enters a contradictory flow where the user
  approves escalation but the session’s `approval_policy=never` rejects the
  same request.
- `$goldband browser session` works in Codex CLI without an app-hosted browser
  provider. Inspection commands can run without prompting; navigation requires
  Codex's normal approval because the Chromium daemon can reach local services.
- Updating Goldband must rebuild the trusted snapshot; source edits alone do
  not change the admitted executable until reinstall.
- The install adds the bundled workflow entrypoints, browser client/server, and
  review assets under `~/.codex/goldband`.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Allow `bin/goldband` by relative path | A workspace can replace that path and inherit the allow decision. |
| Allow the installed skill’s symlinked `bin/goldband` | The link resolves back into the writable Goldband checkout and has the same spoofing boundary. |
| Keep asking for `require_escalated` | Sessions with `approval_policy=never` cannot honor the prompt even after textual user consent. |
| Use Codex App Browser/Chrome plugins from CLI | The CLI session has no registered browser provider even when plugin metadata is installed. |
| Allow every `bun`, `browse`, or `codex exec` invocation | Grants a general sandbox escape far beyond the typed workflows. |

Failure signals:

- Either exact installed workflow command does not resolve to `allow` in
  `codex execpolicy check`.
- A source-tree launcher or unrelated Goldband command matches the generated
  rule.
- Reinstall leaves the marker, snapshot, and rule pointing to different paths.
- Review or browser work asks the user for sandbox escalation despite a healthy
  installation.

Revisit triggers:

- Codex gains a native trusted skill executable or scoped child-agent API that
  removes the outer command admission entirely.
- Codex changes rule precedence, matching, or sandbox behavior.
- The typed runtime no longer needs host state outside the parent sandbox.

## 2026-07-22: Review Runtime Forbids Independent Specialist Agents

Decision: supersede the automatic-specialist default in the earlier interactive
review decision. Every `review/code` run launches exactly one core reviewer.
Independent specialist dispatch is removed from the production owner, and both
the public launcher and shared runtime contract reject `--specialists auto|all`
before any review host starts.

Context:

- A specialist is another full host-model call with its own prompt and a copy of
  the complete review diff, not a zero-cost checklist inside the core reviewer.
- Machine-local evidence on 2026-07-22 recorded 26 review passes selecting 129
  specialists. The core prompts alone contained more than 43 MB before counting
  the duplicated specialist prompts.
- The core reviewer already receives the shared rubric and can evaluate the full
  finding taxonomy in one reusable repository context.
- Automatic keyword and impact-graph routing can identify possible review lenses,
  but it cannot authorize another full model call or prove user consent to the
  quota cost.

Implementation contract:

- `review.ts` contains one host call and no specialist prompt preparation,
  selection, concurrency, or dispatch path.
- `review-runtime-contract.ts` is the shared execution gate. Omitted mode and
  the legacy `off` no-op are valid; `auto` and `all` fail before diff collection
  or host dispatch.
- The public `bin/goldband` launcher does not advertise the option and applies
  the same rejection before it starts the workflow runtime.
- The manifest and checklist assign every review category to the one core
  reviewer in the same repository-reading context.
- Real-host regression coverage counts exactly one host invocation; bypass tests
  prove rejected modes produce zero host invocations.

Assumptions:

- One core reviewer with the complete shared rubric is the correct default for
  ordinary code review.
- Independent second opinions need a separate, explicit capability with its own
  visible cost contract; they are not a hidden mode of ordinary code review.

Consequences:

- Ordinary review no longer hides parallel model fan-out or repeatedly sends the
  same diff to multiple child reviewers.
- Specialist names remain only as optional finding metadata for compatibility;
  they no longer correspond to child processes in this workflow.
- A single reviewer may miss an issue that an independent second opinion would
  find. That tradeoff is explicit rather than paid silently on every review.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Keep `auto` as the default and add a warning | A warning does not prevent hidden quota use or prove informed consent. |
| Keep automatic fan-out but cap it at one specialist | Still turns a normal review into multiple host calls and leaves an agent-opened bypass. |
| Keep `auto` or `all` as opt-in flags | The runtime cannot prove the parent agent did not add the flag itself; prompt-level consent is not enforcement. |
| Keep dormant dispatch code behind a guard | A future caller or refactor can bypass the guard; deleting the production path gives one authoritative owner. |
| Let the parent agent decide whether to append `auto` | Makes quota behavior prompt-dependent instead of runtime-enforced. |

Failure signals:

- Any `review/code` path contains more than one host invocation.
- `--specialists auto|all` reaches diff collection or host dispatch instead of
  failing at the boundary.
- Default telemetry reports a selected specialist.
- Generated contracts or CLI help advertise independent specialist dispatch.

Revisit triggers:

- The runtime can reuse one model context across lenses without starting another
  host call or resending the full diff.
- A separate user-visible cross-review capability gains an enforceable quota
  authorization contract and bounded inputs.

## 2026-07-22: Review Launches Are Single-Owner and Non-Recursive

Decision: make the typed runtime the owner of every deterministic review
execution rule. A public `review/code` launch owns one active child runtime.
That child cannot launch another review, and another session cannot concurrently
review the same canonical repository and scope. Prompts contain only launcher
routing that the outer host must perform and semantic judgment that code cannot
perform.

Context:

- A live Codex review launched a second complete `review/code` process from
  inside the core reviewer. Both runs received the same 310 KB prompt and same
  diff digest, so the second run duplicated cost without adding a distinct
  review contract.
- Workflow and child prompts repeated launch count, polling, read-only,
  approval, schema, specialist, timeout, and recursion rules even after the
  runtime owned those constraints. The duplicate prose increased input tokens
  and overstated what the outer interactive host could enforce.
- Prompt text is not an execution boundary.

Implementation contract:

- The launcher fails before runtime or host startup when
  `GOLDBAND_REVIEW_ACTIVE` is present. The marker is injected only into the
  launched runtime environment and is inherited by its model process.
- Before spawning the runtime, the launcher atomically acquires an owner-only
  lease keyed by canonical repository plus normalized review scope. A live
  matching lease rejects duplicate sessions. Stale replacement first acquires
  a separate exclusive recovery lock, re-reads the current owner, writes a
  same-directory replacement, and atomically renames it over the stale lease.
  Contenders never unlink a lease they merely observed earlier. The owner
  releases its token-matched lease in a `finally` block.
- Durable evidence owns an owner-only coordination directory inside its
  authoritative state root. Ephemeral evidence uses an owner-specific
  coordination directory in the common parent of its runtime-created state
  roots, so independent fallback roots still contend on the same lease without
  re-probing an unauthorized OS temp path.
- Relative `--diff-file` scopes are canonicalized from the invocation directory,
  matching the runtime's actual diff-file resolution.
- Scope flags are parsed into the runtime's effective structured options and
  serialized in a fixed field order, so equivalent `--base` plus `--worktree`
  invocations contend on one lease regardless of CLI argument order.
- Different explicit scopes may run concurrently. Host choice, timeout values,
  and polling behavior do not create a second scope for the same diff.
- The launcher and host adapter own real mode, the single host call, nested and
  duplicate rejection, read-only capability, approval policy, timeout, output
  schema, aggregation, validation, telemetry, and report rendering.
- `review/code --loop` is rejected by the public launcher and unsupported by the
  typed workflow definition. Repeated full-diff passes require a separate,
  explicit capability and cost contract.
- The generated workflow contract contains only installed-launcher routing,
  scope forwarding, failure reporting, and report handoff. The child prompt
  contains only semantic rubric, applicable Rules, impact context, repository
  instruction discovery and the scoped diff.
- The full scoped diff remains in the prompt and fails explicitly above 256 KiB.
  Runtime-selected Rules use manifest-owned compact review criteria and expose
  their full policy source for on-demand inspection. Path-only groups cannot be
  activated by incidental prose inside the diff. Impact context is bounded to
  8 KiB and total non-diff prompt overhead is bounded to 20 KiB.
- Prompt telemetry records diff, Rules, impact, static criteria, total, and
  overhead bytes. Host adapters separately persist numeric input, cache,
  output, total-token, model, and cost fields when exposed by the CLI; raw host
  JSONL and prompt content are not retained as usage telemetry.
- Review strictness remains owned by the shared rubric, checklist, applicable
  Rules snapshot, impact context, full scoped diff, and concrete failure-path
  requirement. This decision removes duplicate execution, not review criteria.

Assumptions:

- Public review execution goes through the installed Goldband launcher.
- The durable state root and the common parent used for ephemeral coordination
  are private to the local user, and process liveness is a sufficient
  stale-lease signal for local duplicate suppression.
- A user who explicitly selects different scopes intends separate reviews.

Consequences:

- A reviewer that tries to invoke Goldband again receives an immediate error
  before another model process starts.
- Two sessions cannot silently spend quota on the same repository and scope at
  the same time, including when each uses a different ephemeral evidence root.
- A killed launcher can leave a lease file, but the next launch recovers it when
  the recorded process is no longer alive. A crashed recovery attempt fails
  closed instead of allowing another paid reviewer to race through cleanup.
- Runtime-owned instructions and the duplicate Markdown finding schema no
  longer consume model input. Full diff, applicable Rules, and semantic criteria
  remain because they affect review quality.
- Outer-host polling and post-report behavior cannot be constrained by the child
  process. The prompt only tells the outer host how to launch and return the
  runtime result; native host lifecycle controls would be required for a hard
  outer-session boundary.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Add only stronger prompt wording | The observed reviewer ignored equivalent guidance and started another runtime. |
| Block every concurrent review in a repository | Prevents intentional staged and base-scope reviews that do not duplicate the same input contract. |
| Keep runtime rules duplicated in prompts | Adds tokens without adding enforcement and makes runtime drift harder to see. |
| Remove the full diff, applicable Rules, or semantic checklist | Changes review coverage before recall quality has been benchmarked. |

Failure signals:

- A model process carrying `GOLDBAND_REVIEW_ACTIVE` starts another public review
  runtime or host model.
- Two live leases exist for the same canonical repository and normalized scope.
- The review workflow contract exceeds its 1 KiB routing budget or contains
  specialist, lease, polling, or second-pass execution prose.
- The child prompt contains runtime task markers, read-only, approval, launcher,
  recursion, or output-schema instructions.
- Token use remains approximately doubled for a single launch with no nested or
  duplicate process evidence.

Revisit triggers:

- The host provides a native, non-bypassable child capability allowlist that can
  replace the environment marker.
- Review inputs gain a measured chunking or context-cache design with defect
  recall parity against the current full-scope prompt.

## 2026-07-29: Style Gate Uses Materialized Hooks and Exact Generated-Text Ownership

Decision: keep the ordinary 1 MB text-file guardrail, add only an exact,
index-tracked generated-text ownership contract, and install global Git hooks
as materialized runtime files outside the Goldband source checkout.

Context:

- The size gate treated every text file above 1 MB as accidental data even when
  a repository intentionally tracked a generated API contract.
- The global `core.hooksPath` pointed directly at `goldband/git-hooks`. During
  an unrelated Git LFS-enabled clone, Git LFS hook templates were written into
  the Goldband worktree as untracked files.
- File contents cannot reliably prove that an artifact is generated. The
  repository must declare one authoritative owner, while freshness remains a
  separate regeneration check.

Implementation contract:

- `.goldband-style.json` schema version 1 may declare
  `largeGeneratedTextFiles` entries with one exact artifact path, one exact
  tracked generator path, and one per-file byte cap.
- The config, artifact, and generator must all exist in the Git index. Globs,
  path aliases, missing generators, duplicate paths, caps at or below the
  ordinary limit, and caps above the generated-text hard limit fail clearly.
- The ordinary text limit remains 1 MB. A declaration cannot exceed the global
  generated-text hard cap, 16 MB by default. Binary limits do not change.
- The declaration establishes repository ownership; projects that claim
  reproducible output must separately regenerate and compare the artifact in
  their project gate or CI.
- `./install.sh style-gate` materializes Goldband-owned hooks under
  `${XDG_CONFIG_HOME:-$HOME/.config}/goldband/git-hooks`, records the source
  checkout plus an ownership schema and per-file checksums, and points global
  `core.hooksPath` there.
- Installer refresh compares source and installed content. Status reports the
  legacy source-checkout path or content drift as stale. Uninstall uses the
  ownership record rather than the checkout location, removes only unchanged
  Goldband-owned materialized files, and preserves unrelated or modified hook
  files.

Assumptions:

- An explicit tracked config and tracked generator are sufficient ownership
  evidence for this guardrail; the global hook is not a provenance or
  reproducibility proof.
- Repositories needing stronger generated-output guarantees own a deterministic
  regeneration check appropriate to their language and build system.
- `${XDG_CONFIG_HOME:-$HOME/.config}` is writable for an explicitly requested
  per-user style-gate installation.

Consequences:

- Ordinary large text, generated garbage, untracked generators, and broad path
  exceptions remain blocked.
- Legitimate large API contracts can be admitted without raising the limit for
  every text file or hardcoding one repository's filenames.
- Git LFS may add hooks to the installed global hook directory, but it no
  longer dirties the Goldband source checkout.
- Moving or deleting the source checkout can make the checker unavailable; the
  existing fail-soft warning remains, and reinstalling refreshes the recorded
  source.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Remove the text-size gate | Loses the original protection against generated garbage and accidental data. |
| Raise the global text limit | Widens every repository and does not distinguish intentional artifacts. |
| Infer generated files from extension, directory, header, or Git attributes | These signals are broad declarations without an authoritative generator owner. |
| Execute arbitrary repo-declared generator commands in the global hook | Turns a machine-wide guardrail into an implicit code-execution surface and is not portable across build systems. |
| Keep `core.hooksPath` pointed at the checkout and ignore Git LFS files | Leaves a shared runtime directory writable by unrelated Git tooling and guarantees recurring worktree pollution. |

Failure signals:

- A text file above 1 MB passes without an exact tracked declaration and
  generator.
- A generated-text declaration accepts globs, an untracked generator, or a cap
  above the global hard limit.
- `core.hooksPath` points at the Goldband source checkout after installation.
- Running Git LFS in another repository creates or modifies files in the
  Goldband worktree.

Revisit triggers:

- Git gains a native composable global-hook registry that isolates each tool's
  owned files.
- Goldband adds a trusted, sandboxed generator protocol that can prove
  reproducibility without executing arbitrary repository code.
- Real generated contracts consistently exceed the hard cap and repository
  evidence supports a new bounded default.

## 2026-07-30: Work Map Runtime Owns Cross-Session Planning State

Decision: use a versioned Work Map under the local Goldband runtime state root
as the authoritative state for work that spans sessions, has dependent
tickets, needs parallel agents, contains in-scope unknowns, or explicitly
requires a tracked plan, roadmap, or handoff.

Implementation contract:

- `goldband-loop/workflows/work-map.ts` owns the schema, validation, dependency
  graph, frontier calculation, and allowed state transitions.
- `goldband-loop/workflows/work-map-store.ts` owns canonical repository-scoped
  persistence, compare-and-swap revisions, atomic writes, deterministic
  Markdown projection, append-only transition events, and the active pointer.
- `${GOLDBAND_HOME:-$HOME/.goldband}/projects/<repository-id>/work/` is the
  Phase 1 authority. Markdown projections, generated contracts, and context
  checkpoints are not alternate Work Map stores.
- `plan/create` remains the one public planning entrypoint. It is available to
  Claude and Codex and delegates validation and persistence to the same typed
  owner; no additional public planning skills are introduced.
- Context checkpoints save only the active Work Map ID, revision, digest, and
  optional active ticket reference. Restore reads the current map and git
  state before reporting freshness and executable frontier.
- External issue trackers and managed worktree binding are deferred. Phase 1
  performs no GitHub, GitLab, or Linear mutation.
- Single-session, low-risk work without dependencies remains in the ordinary
  agent loop and does not require a Work Map.

Assumptions:

- A canonical repository/worktree identity plus branch is stable enough to
  isolate local planning state.
- Local runtime state is sufficient until a collaboration adapter has explicit
  identity, authorization, idempotency, and readback contracts.
- Ticket dependency state is the only Phase 1 input to frontier calculation;
  models never author the stored frontier.

Consequences:

- Cross-session planning state can be validated, resumed, and compared by
  revision without copying it into prompts or checkpoints.
- Local state is not automatically shared across machines or collaborators.
- Runtime and installer tests expand because the typed owner must work from an
  installed Goldband surface for both supported parent hosts.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Store the plan only as Markdown | Markdown cannot provide strict schema validation, dependency invariants, or compare-and-swap updates. |
| Add separate `grill-me`, `to-spec`, `to-tickets`, or `wayfinder` skills | Splits one planning state machine across public routes and makes host parity harder to verify. |
| Use an issue tracker as the Phase 1 authority | Introduces provider identity, credentials, network mutation, and synchronization conflicts before the local contract is stable. |
| Copy the complete Work Map into each context checkpoint | Creates duplicated state that can drift from the authoritative map. |
| Bind Work Maps to managed worktrees immediately | Couples planning state to a separate execution boundary before ticket claim and evidence semantics exist. |

Failure signals:

- A model-supplied frontier or Markdown projection is accepted as authority.
- A stale revision overwrites a newer map, or a failed write corrupts the last
  valid state.
- Repository, worktree, branch, symlink, or traversal boundaries can redirect
  state writes.
- Claude and Codex produce or consume different Work Map contracts.
- Ordinary small changes are blocked until a Work Map is created.
- A context checkpoint duplicates Work Map content or resumes stale state as
  current.

Revisit triggers:

- Phase 2 defines ticket claim, implementation, verification, and evidence
  transitions.
- Phase 3 defines an external tracker adapter with explicit authorization,
  idempotency, conflict handling, and round-trip readback.
- Canonical repository identity proves insufficient for a supported worktree,
  clone, or cross-machine workflow.

## 2026-07-31: Work Map Evidence Is Bound Through Runtime Readback

Decision: bind a Work Map ticket, managed worktree lease, verification receipt,
review artifact, and integrated commit through stable IDs and SHA-256 digests.
The Work Map store is the only ticket-transition owner.

Implementation contract:

- A bound managed worktree can claim only an active frontier ticket and records
  the Work Map ID/revision, ticket ID, lease ID, and ticket-contract digest.
- `goldband-work-verify` executes command argument arrays without shell
  interpolation. It stores a bounded redacted summary and full-output digest,
  enforces verification-mode rules, and advances a successful ticket to
  `implemented`.
- TDD evidence requires a failing RED with an expected signal followed by a
  successful GREEN on the same declared seam. A changed candidate invalidates
  the current receipt. Requested changes increment a claim attempt, and records
  from an earlier attempt cannot satisfy the new receipt.
- Existing-test tickets persist the exact planning command argument array and
  reject substitute commands, even when the substitute exits successfully.
- Analysis-only tickets use a normalized named artifact copied into broker-owned
  state, with an analysis claim and review lifecycle but no code worktree.
- Work Map-scoped `review/code` treats ticket text as untrusted project data.
  Its scope is runtime-owned: code review uses the canonical candidate diff and
  analysis review uses the recorded artifact. The review artifact binds the map
  revision, ticket and subject digests, reviewed diff digest, and candidate or
  artifact digest. Runtime readback, not reviewer prose, advances the ticket to
  `verified` or requested changes.
- Canonical candidate diffs use the same bounded untracked-file materializer as
  ordinary review, including secret-like-content skips and stable descriptor reads.
- Bound `worktree finish` reads the lease, map, ticket, receipt, review
  artifact, and current candidate. It integrates only a matching verified
  chain, then records the integrated commit through the Work Map store.
- Integrated-commit readback retries revision CAS conflicts caused by unrelated
  map updates and refuses to overwrite a different recorded commit.
- Standalone managed worktrees remain supported but cannot emit Work Map
  evidence.

This is an evidence-integrity and workflow gate, not a security boundary
against a user or process with the same host account and filesystem access.

Failure signals:

- Evidence from another map, ticket, lease, base commit, or candidate is reused.
- RED proves an unrelated failure or GREEN has no earlier matching RED.
- A successful command different from the planning command is accepted.
- Caller-selected review scope differs from the candidate that finish integrates.
- An analysis-only ticket has no named-artifact completion path.
- Reviewer output directly edits Work Map state.
- Finish checks only ticket status and ignores artifact provenance.
- Full command output or secret-like values are persisted as summaries.
- Claude and Codex installed runtimes expose different evidence contracts.

## 2026-08-23: Claude Review Cost Caps Follow the Active Billing Authority

Decision: do not apply estimated-dollar limits to subscription-authenticated
Claude reviews. Preserve an explicit bounded cap for metered credentials.

Implementation contract:

- Claude's documented environment credential precedence is applied before the
  `claude auth status --json` projection. Higher-priority cloud-provider,
  including Claude Platform on AWS, bearer-token, and API-key credentials stay
  metered even when a lower-priority OAuth token is present. The adapter retains
  only `loggedIn`, `authMethod`, and `apiProvider`; identity fields and
  credential values are neither logged nor persisted.
- `claude.ai` and `oauth_token` are subscription modes. Goldband omits
  `--max-budget-usd` because locally estimated API-equivalent dollars are not
  the subscription quota owner.
- `api_key`, `api_key_helper`, and `third_party` are metered modes. Goldband
  applies a `$3.00` default safety cap and accepts a validated per-run
  `--review-claude-max-budget-usd` override.
- Unknown, unauthenticated, inconsistent, or malformed auth state fails before
  model dispatch. Goldband never guesses that a potentially paid call is safe.
- The resolved billing mode and cap are written to host telemetry. Subscription
  telemetry drops API-equivalent `costUsd`; metered telemetry retains it for
  paid-run attribution. Raw auth status and account identity are not retained.
- A budget-exhausted result remains an incomplete review. It cannot be rendered
  as `No findings`, and the non-streaming JSON contract cannot claim that
  partial findings were recovered.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Keep one hard-coded cap for every Claude login | Subscription quota is not denominated by the local API-equivalent estimate, and the old `$0.50` cap repeatedly terminated valid reviews. |
| Remove the cap for every Claude login | Silently widens paid API, gateway, and cloud-provider side effects. |
| Infer subscription mode only from absent environment variables | `apiKeyHelper` and provider configuration can be active without a visible API-key variable. |
| Use `subscriptionType` as the authority | Claude CLI can report a valid Claude.ai auth method while the subscription field is absent or stale. |

Failure signals:

- A subscription review receives `--max-budget-usd`.
- A metered review launches without a validated cap.
- Auth status cannot be classified but model dispatch continues.
- Account email, organization, token, or raw auth JSON appears in telemetry.
- Budget exhaustion is reported as a completed review or `No findings`.

## 2026-08-25: Review Is Evidence-First With Conditional Scoped Closure

Decision: make typed runtime evidence the authority for reproducible behavior
claims, keep one semantic host for omission discovery, and allow one separate
closure host only after findings cause a candidate change.

Implementation contract:

- A project-owned `goldband.review-evidence.json` declares stable behavior cell
  IDs, expected behavior, risk, disposition, provider owner, applicability,
  sandbox, network, timeout, output, replay, and evidence-level contracts.
- The runtime validates schemas and reciprocal provider/cell relationships
  before model dispatch. Every operation receives a newly materialized read-only
  snapshot; the runtime uses a default-deny read/write/network Seatbelt profile
  with Apple's common system process baseline plus explicit candidate, runner-state,
  sealed runtime-projection, and projected dependency roots. A Mach-O runtime with
  non-system links is copied into a private projection; Goldband rewrites only its
  attested non-system install names, ad-hoc signs the copies, sanitizes OpenSSL config
  loading to `/dev/null`, and attests the final executable bytes. The sandbox cannot
  read the original package tree or write the projection. Goldband explicitly
  re-denies the baseline's exact syslog, Mach service, and shared-memory channels in
  addition to broad network, system-socket, and Mach lookup denial,
  so commands cannot use the local system log as an output side channel. The baseline
  common Mach allow-clause set is parsed from the current `system.sb` and must
  exactly match the reviewed contract. Global/local names, registration prefix,
  XPC lookup prefix, and bootstrap operations receive matching explicit denies;
  an added or removed Apple clause fails before execution. Live macOS probes prove
  the syslog socket and one global-name Mach lookup remain blocked; prefix and
  registration clauses currently have deterministic profile assertions, not live probes.
  Executable sealed evidence has one supported adapter: macOS Seatbelt. Linux and
  Windows stop before operation materialization with typed `runtime-incomplete`
  evidence, no semantic conclusion, and no completion authority. Linux Bubblewrap
  continues to isolate managed worktrees and is not treated as review-evidence parity.
  The baseline does not grant arbitrary HOME, workspace, or temporary-directory
  reads. The runtime
  compares pre/post snapshot digests, gives it
  unique HOME/TMP state that is removed after execution,
  bounds time and output, and persists fresh
  records bound to repository, base, candidate, scope, behavior, command,
  owner, environment, timing, exit status, and output digest.
- Regression providers require base/exact-nonzero RED and candidate/zero GREEN;
  an unspecified non-zero exit is invalid and sandbox denial is runtime-incomplete.
  Property/fuzz providers require a seed, iteration budget, and replay command.
  High-risk unsupported cells and incomplete runtime evidence fail closed.
- The initial semantic host receives the complete candidate diff exactly once,
  plus bounded behavior and evidence projections and applicable review Rules.
  Raw logs, runner policy, leases, timeout mechanics, and artifact management
  stay in code.
- Runtime normalization owns finding IDs, deduplication, evidence binding,
  classification, and blocking eligibility. Only deterministic runtime findings
  can produce a `verified-failure`; the semantic host cannot promote a concern
  by citing a failed record, and unrelated record IDs are removed. Unbound risks are
  `semantic-concern`, and gaps or unavailable runtime stay distinct.
- Initial artifacts retain the diff for deterministic local delta derivation,
  but host telemetry never stores prompt text. Reports and Work Map artifacts
  bind evidence completeness, record digests, phase, and host-call count.
- Every initial artifact is issued with a separate canonical installed-runtime
  receipt binding its complete serialized payload, findings, evidence,
  timestamps, candidate, behavior contract, and standalone or Work Map scope.
  Work Map scope also binds map revision, reviewed subject, and claim attempt;
  closure requires authoritative requested-changes readback from the immediately
  following repair attempt. Caller-authored, edited, copied-across-scope,
  prior-attempt, or receipt-less JSON has no closure authority.
- Closure receipt consumption is an atomic, runtime-owned at-most-once claim made
  only after repaired candidate binding and Work Map causality validation. Once
  claimed, a crash, evidence failure, or host failure leaves the receipt spent;
  retry requires a new initial review. This deliberately favors fail-closed
  single-use authority over ambiguous crash recovery or concurrent replay.
- The receipt authority protects against reviewed candidate code, model output,
  and caller-provided artifact JSON. As elsewhere in the managed-worktree threat
  model, the same-permission host user and installed Goldband runtime are trusted;
  resisting a malicious same-user process would require a privileged helper or
  an OS-backed key unavailable to that process.
- Bounded regular untracked files omitted from the semantic diff for secret or
  binary safety remain path/content-digest-bound. Their exact bytes enter only
  the isolated executable snapshot. Unsafe, escaping, or oversized redacted
  files fail closed before provider execution.
- Closure is a separate invocation using the initial artifact and repaired
  candidate. Runtime records both behavior-contract digests, derives a compact
  multi-hunk repair delta that omits unchanged middle regions, includes newly
  disclosed or modified cells, reruns only affected
  providers, rejects non-original finding IDs, and accepts only
  `closed`, `still-open`, `direct-regression`, or `evidence-incomplete`.
- Closure evidence must intersect the original finding's authorized behavior
  cells. Persisted records are fully validated against provider/disposition
  contracts, and stored completeness is recomputed rather than trusted.
- `closed` requires fresh passing rerun evidence; an original verified failure
  specifically requires its failed operation to rerun successfully. Work Map
  artifacts retain bounded evidence records so finish can recompute their digest.
- A Work Map transition exception does not by itself authorize artifact cleanup.
  The review runtime first triggers transaction recovery and reads back the predicted
  transition revision plus exact review reference. A committed reference is preserved
  and treated as success; cleanup occurs only when readback proves the ticket remains
  at the pre-transition implemented revision. Ambiguous readback fails closed while
  preserving artifacts and receipts that a recoverable transaction may reference.
- The unchanged-operation check binds seed/iterations, source executable content,
  transitive non-system runtime-library alias/target/content attestation, transformed
  projection content/mode/tool identity and sanitized runtime environment,
  runner policy/platform, dependency locks and package metadata, and projected
  command shims. Runtime libraries are re-attested after execution; drift makes
  the record incomplete and not fresh. A changed execution identity requires a
  new initial review.
- A zero-finding initial review cannot launch closure. Each invocation has a
  one-host-call budget; closure receives zero bytes of the unchanged full
  original diff and cannot create a general findings inventory.

Assumptions:

- Projects can own a small explicit behavior/evidence manifest instead of one
  universal command list.
- macOS Seatbelt is the current local evidence runner boundary. Other platforms
  must add an equivalent deny-network snapshot runner before real review can
  claim parity.
- External network, credential, paid, shared-environment, device, and
  production evidence needs a separate operation-specific runner and typed
  authorization; the local runner remains deny-only.

Consequences:

- Reproducible checks run before semantic token spend, and the reviewer focuses
  on omissions rather than redoing deterministic work.
- Existing projects must add a valid evidence manifest before real semantic
  review; missing configuration is an explicit blocked state.
- Initial review remains one full-diff host call. A repair may add one bounded
  closure call without hidden specialists or full-diff resend.
- Fixture and local results cannot be mislabeled as live, device, provider, or
  production proof.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Keep prose evidence fields and strengthen the prompt | A model cannot prove commands ran, replay failures, or enforce candidate freshness. |
| Let the reviewer choose and run arbitrary commands | It weakens read-only isolation, hides side effects, and wastes semantic tokens on deterministic work. |
| Automatically infer one universal test command | Projects own different contracts; guessed checks create false confidence and fake portability. |
| Re-run the full review after every repair | It resends unchanged content, reopens the findings inventory, and hides a second full review cost. |
| Treat every plausible concern as a blocker | Unreproduced risk is useful, but presenting it as verified failure corrupts the evidence model. |

Failure signals:

- A semantic host starts before matrix, provider, evidence, freshness, and
  provenance validation finish.
- Operations share a writable candidate snapshot or omit pre/post tree attestation.
- Operations share HOME/TMP state or can read a previous operation's residue.
- An evidence command can read content outside its candidate, runner state,
  sealed runtime projection, or projected dependencies.
- A dynamically linked runtime can read its original host package tree, mutate its
  projection, or execute transformed bytes that are absent from the command identity.
- A prompt-redacted untracked file disappears from the candidate binding or
  executable snapshot.
- A provider satisfies a cell without reciprocal manifest ownership.
- A RED operation accepts an arbitrary non-zero process or sandbox failure.
- A semantic finding is promoted to verified failure by citing a failed record.
- A semantic finding gains deterministic authority by spoofing a runtime-owned category.
- Closure accepts passing evidence unrelated to the original finding cells.
- Artifact reuse trusts a forged disposition record or stored completeness.
- Closure accepts an initial artifact without matching runtime-state readback,
  or reuses a standalone receipt for a Work Map transition.
- A verified blocker lacks fresh replayable candidate-bound failed evidence.
- A fixture or local record is described as live, device, or production proof.
- Closure runs after zero findings, accepts a new finding ID, resends the full
  original diff, or invokes more than one host.
- Raw logs or runtime-owned control prose re-enter the semantic prompt.
- Work Map finish accepts a version-2 review artifact without its evidence
  chain.

Revisit triggers:

- Linux or Windows gains an equivalent tested local snapshot and network
  boundary.
- A reusable external evidence runner can verify typed authorization and
  concrete provider/device/production readback without widening local review.
- Stable project behavior contracts can be generated from another authoritative
  artifact without losing owner review or explicit dispositions.

## ADR: Review contract freshness and installed distribution identity

Status: Accepted

Decision:

- Keep one review authority. Add `check:review-contracts` to the existing root
  test and CI graph instead of creating a parallel review, approval, receipt, or
  release workflow.
- Require every reusable provider to declare `persistent` lifecycle, explicit
  path-scoped or reasoned-global applicability, and an execution context with
  one sandbox owner. Repository manifests reject `transition` providers and
  persistent base/nonzero RED operations.
- Bind transition evidence to the exact repository, base, candidate, scope, and
  normalized operation contract. Explicit transition manifests and persisted
  initial artifacts use that validator in the production ingestion path; a
  successor candidate cannot inherit them.
- Use applicable providers to derive the effective behavior-cell set for
  completeness. Cells owned only by unrelated path scopes do not become
  coverage gaps; ownerless explicit dispositions remain global.
- Return a typed partial record before dispatch when a provider-owned Seatbelt
  suite cannot run inside the sealed evidence runner. Only the named macOS host
  lane runs that boundary; partial results have no completion or closure
  authority.
- Derive one installer-owned source-input digest from all setup/build/config,
  generated contracts, launcher/runtime sources, rules, skills, migrations,
  review/QA/design assets, and browser/PDF bundles read or copied by setup. The
  trusted install stores a separate artifact inventory and digest over runtime
  bytes plus the launcher marker and execpolicy rule written beside it.
- Declare dispatch per canonical action as `trusted-launcher`, `host-runtime`,
  `prompt-contract`, or `registered-only`. Status and temp-install inventory run
  bounded fake-handler probes through the same production router used by the
  explicitly trusted launcher set.

Why:

Local gates previously proved only their own files. They could all pass while a
one-time RED became permanent, empty applicability silently became global,
nested Seatbelt was misclassified as a regression, or installed runtime bytes
drifted outside a two-file fingerprint.

Consequences:

- Missing applicability, empty path lists, unexplained global scope, stale RED,
  unsupported execution context, source drift, artifact corruption, and
  dispatch mismatch now fail with the owner, actual/expected contract, scope,
  context, and repair location.
- A source change and an installed-byte mutation are reported separately.
- Compatibility actions such as `investigate/code` are not promoted into the
  fixed launcher, and registered-only actions remain blocked.

## ADR: Runtime-owned review acceptance lineage

Status: Accepted

Decision:

- Persist one HMAC-signed lineage per canonical repository/base/scope under the
  installed review receipt authority.
- Compare inherited behavior cells and providers before evidence execution.
  Existing requirements are monotonic; new cells/providers may be added.
- Preserve blocking finding IDs and behavior-cell bindings. A successor initial
  review cannot supersede them; only the authoritative initial artifact may
  enter scoped closure.
- Route an authoritative `hostCallCount=0` artifact containing only deterministic
  findings through a typed pre-semantic evidence-repair transition. Reuse the
  existing artifact flag, receipt authority, lineage owner, monotonic contract
  comparison, and at-most-once claim rather than adding another mode or receipt.
  The repair reruns affected and newly strengthened cells; an eligible result may
  make the lineage's first initial semantic call, while an ineligible result
  persists a successor deterministic-only artifact and keeps completion false.
- Record predecessor artifact, receipt, candidate/contract digests, finding IDs,
  and affected cells in the successor initial artifact. Allow only gap-to-typed
  disposition strengthening (`manual` or `unsupported` to `automated`, `static`,
  or `runtime-readback`); reverse and lateral changes still require base-owned
  waiver authority.
- Bind lineage to Work Map acceptance when present, selected Rules, base,
  candidate, scope, and manifest identities.
- Reject an empty initial candidate before acquiring or writing authoritative
  lineage state. For standalone reviews, bind lineage identity to normalized
  changed paths as well as the collection scope. A repair keeps the original
  path scope and must use its authoritative artifact for closure.
- Preserve upgrade safety with signed legacy read-through: a broad-scope legacy
  blocker migrates only when its artifact digest verifies the same changed-path
  scope. An empty or unrelated legacy artifact remains stored but cannot pollute
  a different candidate. If the artifact is unavailable, an exact signed
  candidate-digest match still preserves the blocker; other candidates do not
  inherit the unverifiable broad scope.
- Treat non-empty changed-path overlap inside one standalone collection scope as
  the same unresolved authority for admission purposes. A repair that adds or
  removes paths cannot start a successor initial review while any original path
  still overlaps; it must use the authoritative closure artifact.
- Acquire deterministic sorted per-path locks before overlap discovery and hold
  them through lineage finalization or release. Overlapping candidates therefore
  serialize across scan and write, while disjoint candidates keep independent
  concurrency.
- Load minimum evidence requirements and waivers only from typed
  `goldband.review-policy.json` in the base commit. Persist applied waiver IDs in
  the signed lineage record.
- Keep verdict dimensions separate. `no-new-findings` alone never grants Work
  Map verification or completion authority.

Why:

Fresh candidate-bound evidence can still prove a caller-weakened contract. A
runtime-owned predecessor is required to detect removal, semantic reversal,
risk/disposition/evidence downgrade, provider replacement, or finding
detachment before semantic review can wash away an earlier blocker.

Consequences:

- Concurrent equivalent reviews have one lock owner, dead owners are
  recoverable, and signed records detect state tampering.
- Legitimate weakening requires a reviewable base-committed waiver; additive
  coverage remains valid without a waiver.
- A failed Work Map readback keeps the signed lineage and named artifact, so a
  later review cannot erase a blocker because a projection transition failed.
- Block messages name the authoritative run, creation time, lineage update time,
  changed-path scope, and unresolved finding IDs. They provide the exact
  state-appropriate `--closure-artifact` instruction when the artifact still
  verifies; otherwise they name the expected digest and the required
  restore-then-repair or restore-then-close recovery.

## ADR: Same-host execution for provider-owned review evidence

Status: Accepted

Decision:

- Keep host evidence inside the existing installed review pass. A trusted
  runtime on macOS may execute the exact manifest-declared operation through
  the existing candidate snapshot and one provider-owned Seatbelt boundary.
- Require the installed private runtime configuration to authorize the named
  `macos-review-contract-host` lane. Bind the execution identity to repository,
  base, candidate, scope, manifest, provider, operation, runner context, runtime
  images, projected dependencies, platform, and architecture.
- When an outer evidence sandbox is active, the host or lane is unsupported, or
  installed authority validation fails, emit typed `runtime-incomplete` before
  dispatch. Never retry without Seatbelt and never consume caller-supplied
  result JSON.
- Reuse the existing review receipt, lineage, evidence records, semantic host,
  and completion decision. Do not create a portable CI artifact or a second
  handoff authority for this same-host requirement.

Why:

The execution-context preflight correctly prevented nested Seatbelt, but it
also made semantic review unreachable for every applicable host-bound provider.
The installed launcher already owns the exact review, candidate materialization,
receipt, and lineage needed for a same-machine handoff.

Assumptions:

- The installed private runtime configuration and receipt key remain owned by
  the current user and are not writable by the reviewed candidate.
- macOS Seatbelt remains the supported local boundary for this lane.
- Manifest operations remain deny-network and run only against the runtime-owned
  read-only candidate snapshot plus isolated HOME/TMP roots.

Consequences:

- Supported installed macOS reviews can obtain fresh host-bound records and
  continue to the single semantic host call.
- Source runtimes, Linux, unsupported lanes, and outer sealed sandboxes remain
  incomplete with zero completion authority.
- Cross-machine CI transport, signing, freshness, and key management remain out
  of scope until a demonstrated use case requires them.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Permit nested Seatbelt | The host rejects it and treating that failure as evidence would weaken the boundary. |
| Run the candidate command unsandboxed | It would let a writable manifest expand host access beyond the review contract. |
| Add a portable signed CI artifact now | Same-host execution closes the current requirement without transport, freshness, or cross-machine key management. |
| Add a second handoff receipt | The installed review receipt and lineage already own authority; another receipt would create conflicting owners. |

Failure signals:

- A source runtime, wrong host, unsupported lane, or outer evidence sandbox
  produces a fresh verified host record.
- A host operation runs without Seatbelt, with network access, or against the
  writable source worktree.
- Changing repository, base, candidate, scope, manifest, provider, operation,
  or runner context leaves the execution identity unchanged.
- A host result can be edited or reused while its installed receipt still
  validates.

Revisit triggers:

- A required review operation cannot execute on the same trusted macOS host.
- Linux or Windows gains an equivalent tested provider-owned sandbox.
- A demonstrated cross-machine review needs portable attestation, freshness,
  transport, and key-rotation contracts.

## ADR: Scope external-runner enforcement through provider applicability

Status: Accepted

Decision:

- Model `external-authorized-runner` as an automated boundary owned by the
  existing path-scoped `review-evidence-tests` provider.
- Keep providerless `manual` and `unsupported` dispositions global. Do not
  change effective-cell selection or add caller-, prompt-, environment-, or
  prose-driven applicability.
- Keep external runner availability separate from admission enforcement. A
  declared network, live-provider, device-platform, or production-readback
  operation still requires current typed authorization and an
  operation-specific external runner; the local runner remains deny-only.

Why:

The previous providerless `unsupported` cell represented both an implemented
fail-closed boundary and a future external-runner roadmap item. Because
providerless dispositions are intentionally global, unrelated local-only
candidates received a permanent coverage gap even when they declared no
external operation.

Assumptions:

- `review-evidence-tests` remains the authoritative deterministic owner of
  local external-operation rejection.
- Provider applicability continues to be derived only from the typed manifest
  and candidate paths.
- External runner implementation remains outside the current requirement.

Consequences:

- Unrelated local-only candidates no longer inherit an external-runner roadmap
  gap and can obtain completion authority when all applicable evidence passes.
- Changes to the evidence manifest, schema, runtime, or its tests still select
  the enforcement cell and provider.
- Existing artifacts bind a different behavior-contract digest and must be
  revalidated rather than reused across this evolution.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Make every providerless disposition non-applicable | It would silently remove genuine global manual and unsupported requirements. |
| Add operation-aware cell applicability to the schema | Existing provider applicability expresses the observed requirement without another state owner or selection mechanism. |
| Mark the roadmap gap `not-applicable` | It would hide the boundary instead of assigning its implemented enforcement to an accountable provider. |
| Use a prompt, environment marker, or caller declaration | Those inputs are outside the authoritative manifest/runtime contract and would create a bypass. |

Failure signals:

- A local-only dependency candidate emits an `external-authorized-runner`
  record or coverage gap.
- An authorized network or external-level operation executes in the local
  runner, degrades to fixture/mock/local evidence, or obtains completion
  authority without an external runner.
- A providerless global manual or unsupported cell disappears from effective
  completeness.

Revisit triggers:

- A real external runner is implemented and needs its own typed provider,
  authorization, freshness, and readback contract.
- Provider path applicability cannot represent an observed external-operation
  requirement without over- or under-selecting candidates.

## ADR: Monotonic review contract resolution and local repository store

Status: Accepted

Decision:

- Resolve `authoritative baseline + optional monotonic extension = effective
  contract` before evidence execution, lineage admission, or semantic host
  dispatch.
- Prefer a repository `goldband.review-evidence.json`. Only when it is absent
  may a runtime-owned per-repository entry become the baseline. A caller-supplied
  explicit manifest cannot shadow either baseline and must retain every required
  cell, provider, applicability, risk, disposition, and evidence level.
- Permit an explicit persistent manifest to be the primary contract only when no
  repository or stored baseline exists. Mark that source in artifact provenance.
- Bind store entries to the canonical Git common-directory path and filesystem
  instance plus a remote-identity snapshot. Worktrees share one entry; moves,
  path reuse, clones, remote changes, and
  ambiguous identity require explicit re-import.
- Expose `review contract inspect`, `import --manifest`, and `remove`. Mutations
  use private regular files, reject symlinks, write atomically, and never alter
  the source manifest or repository working tree.
- Bind baseline, explicit, and effective source identities and digests plus the
  compatibility identity into the existing review artifact, receipt digest, and
  lineage path. Do not introduce another acceptance or completion authority.

Why:

The previous explicit-manifest resolver could replace a stronger repository
contract before a predecessor lineage existed. Repositories without committed
manifests also had no persistent evidence-backed path. One deterministic resolver
closes both gaps without inventing generic JSON merge semantics or runtime-guessed
providers.

Consequences:

- A weaker explicit contract fails before provider execution or host dispatch,
  including a first review for a new scope.
- Repository requirements always shadow local convenience state, while `inspect`
  still reports the shadowed entry.
- The store remains local-only. It does not synchronize contracts, transport CI
  authority, infer behavior matrices, or implement semantic-only review.
- Existing repository manifests remain valid in place and are never migrated or
  removed automatically.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Let explicit manifests replace the baseline | A new lineage could start with fewer required cells and appear complete. |
| Automatically copy a missing manifest into the repository | It would mutate user worktrees and turn onboarding into hidden policy state. |
| Merge arbitrary manifest fragments | It creates ambiguous conflict semantics and a second composition language. |
| Key the store only by remote URL | Forks, URL reuse, and remote rename can bind the wrong repository. |

Failure signals:

- A weaker explicit manifest reaches an evidence operation or semantic host.
- A central entry shadows a repository manifest or applies after identity drift.
- Review creates, moves, edits, or deletes a repository manifest.
- Artifacts omit any selected baseline, explicit, or effective digest.

## ADR: Retire the GBrain integration surface

Status: Accepted

Decision:

- Retire GBrain as a public capability, supported host, installed runtime, and
  setup or synchronization path. This supersedes earlier decisions that
  described it as an active Goldband integration.
- Keep `knowledge/recall` under the `goldband-knowledge` owner, along with
  context checkpoints, project learnings, and provider-neutral artifact Git
  synchronization.
- Move shared Git remote normalization into a provider-neutral owner. Do not
  create a replacement provider abstraction until a concrete integration has
  verified requirements and runtime ownership.
- Rebuild Goldband-managed Claude and Codex runtime roots during upgrade so
  stale retired files disappear. Do not inspect, modify, or delete user-owned
  provider configuration, databases, external resources, registrations, or
  diagnostic residue.
- Enforce the retirement through the existing manifest generation and runtime
  inventory checks, including clean install, copy fallback, seeded-stale
  upgrade, and controlled reintroduction fixtures.

Why:

The shipped surface advertised setup and synchronization actions without a
runtime owner, while directly executable helpers could still perform provider
installation, transcript ingestion, external provisioning, and registration.
The repository also lacked an authoritative upstream and live compatibility
lane. Removing that unowned surface is smaller and safer than preserving it
behind a speculative provider framework.

Assumptions:

- Curated knowledge, context checkpoints, project learnings, and artifact Git
  synchronization remain independently useful without a semantic-memory
  provider.
- Rebuilding only Goldband-managed runtime roots is sufficient to retire stale
  installed files without identifying or touching user-owned assets.
- A future provider can be evaluated from its actual contract without keeping
  the retired integration or a generic provider framework alive.

Consequences:

- `knowledge` exposes only `recall`, and the supported host list no longer
  includes GBrain.
- Existing user-owned GBrain assets remain untouched but are no longer read,
  written, installed, upgraded, health-checked, or uninstalled by Goldband.
- Provider-neutral artifact queue, push, restore, and uninstall behavior
  remains available without provider hookup commands or transcript staging.
- Historical changelog, archived documents, and earlier decisions remain as
  history; this ADR is the current authority.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Repair and re-enable the existing integration | There is no authoritative upstream, runtime owner, or live compatibility lane to support the advertised contract. |
| Keep the helpers but hide the public workflow actions | Direct installed binaries would retain the same side-effect and data-boundary bypass. |
| Introduce a provider abstraction before removal | No current replacement has verified requirements, so the abstraction would preserve speculative states and maintenance cost. |
| Delete all memory and sync behavior | It would remove curated knowledge and provider-neutral artifacts that have independent owners and regression coverage. |

Failure signals:

- A generated or installed surface contains a retired host, action, binary,
  route, or provider-specific instruction.
- Install or upgrade changes a user-owned provider path, registration, remote
  resource, or diagnostic residue.
- Curated knowledge, context, project learnings, or provider-neutral artifact
  synchronization loses its runtime owner or regression coverage.

Revisit triggers:

- A replacement provider has an authoritative upstream, license and security
  review, explicit data boundaries, a runtime owner, and live compatibility
  evidence.
- Provider-neutral artifact synchronization itself no longer has demonstrated
  users or cannot maintain its privacy and secret-scanning contract.

## ADR: Canonical review workspace and base-owned manifest authority

Status: Accepted

Decision:

- Resolve the canonical Git repository root and invocation-relative execution
  offset once. Diff paths, changed files, candidate binding, scope digest,
  snapshots, dependency projection, and default manifest lookup use repo-root
  coordinates. Provider operations execute at the validated offset inside the
  isolated repo-root snapshot.
- Read the authoritative repository manifest from the reviewed base at the repo
  root. A runtime-store contract is authoritative only when that base has no
  manifest. Working-tree, index, and explicit manifests are candidate extensions
  and must pass the existing monotonic comparison before any evidence operation
  or semantic host dispatch.
- Persist workspace coordinates plus base, candidate, store, and explicit source
  identities, digests, and candidate tracking state in the existing artifact and
  lineage contract. Do not create a second completion authority or a nested
  manifest hierarchy.
- Use review evidence manifest schema v2 for the required `lifecycle`,
  `applicability`, and `executionContext` safety fields. Permit v1 only as the
  committed-base side of a one-version transition to a v2 candidate, and only
  when changing the base version marker alone passes the complete v2 contract.
  Reject every other v1 input with observed and supported versions, source
  identity, and explicit migration guidance; never infer safety defaults.

Why:

Subdirectory invocation previously mixed repo-root Git patch paths with a
stripped subdirectory snapshot, and selected default manifests from ambient
`cwd` even though runtime-store identity used the Git common directory. A
candidate-controlled untracked or modified manifest could therefore appear to
be repository authority. The old schema label also concealed a breaking safety
contract change.

Assumptions:

- Git repo-root paths are the stable coordinate for all default review scopes.
- A provider that intentionally runs from the invocation subdirectory can do so
  safely only inside the materialized canonical snapshot.
- Nested project contracts are out of scope until they have an explicit,
  persistent scope identity and monotonic relationship to the repo-root base.

Consequences:

- Root and tracked-subdirectory invocations share repository identity, baseline,
  and digest while exposing different execution offsets.
- Default, worktree, staged, and base diffs include one consistently materialized
  repo-root scope, including changes outside the invocation subdirectory.
- Untracked, staged-new, and modified manifests remain reviewable changes but
  cannot shadow or downgrade base/store authority.
- Repositories and imported stores must migrate manifests to schema v2 before
  the new runtime can execute review, apart from the narrowly validated
  committed-v1-base to v2-candidate transition.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Strip patch paths for subdirectory snapshots | It fixes one apply failure but leaves diff scope, manifest authority, dependencies, and lineage on conflicting coordinates. |
| Walk parent directories for the nearest manifest | Ambient directory names remain implicit authority and enable an undefined nested hierarchy. |
| Trust any Git-indexed manifest | Staged-new and candidate-modified files are still candidate-controlled rather than reviewed-base authority. |
| Guess defaults for legacy v1 safety fields | Global/path applicability and runner ownership are safety decisions, not compatible defaults. |

Failure signals:

- Root and subdirectory inspect return different baseline identities or digests.
- A repo-root patch cannot materialize from a tracked subdirectory.
- Candidate manifest content reaches an operation without monotonic comparison.
- An artifact omits workspace offset or base/candidate source provenance.

Revisit triggers:

- A real nested-project contract requires an explicit scope identity and
  repo-root monotonic composition rule.
- Git is no longer the authoritative candidate/base transport for review.

## ADR: Goldband Loop complexity debt is monotonic

Status: Accepted

Decision:

- Enforce the shared source thresholds for Goldband Loop: at most 50 nonblank
  lines per function, cognitive complexity 12, and four parameters.
- Keep normal source lint focused on correctness. A dedicated Biome-backed gate
  owns these quantitative rules and compares normalized per-file violation
  vectors with a checked-in baseline.
- Reject a worsened sorted magnitude vector for each file and rule. Require an
  explicit baseline update when aggregate debt decreases, so line movement alone
  cannot hide the vector change and the baseline can only shrink. Compare
  candidate baseline values with the GitHub
  push-before SHA, GitHub merge-base, GitLab diff base, or parent of the local
  baseline-changing commit. CI fetches full history, and an unavailable required
  predecessor is an error rather than an implicit pass.
- Refactor the executable evidence runner first because it crossed all three
  limits. Do not attempt an unrelated repository-wide rewrite in the same change.

Why:

Goldband Loop had no local quantitative gate and already contains substantial
legacy debt. Enabling the thresholds as immediate zero-tolerance lint would make
the source gate unusable; leaving them unenforced would allow the debt to grow.
The normalized monotonic baseline makes current debt visible without weakening
the shared thresholds or claiming the existing source already complies.

The baseline intentionally has no function identity. A repair that removes a
larger violation can therefore offset a different function becoming worse while
the ranked vector still improves. Baseline reductions require diff review; this
gate does not claim per-function regression identity.

Revisit triggers:

- The baseline reaches zero and the rules can move into ordinary source lint.
- Biome changes diagnostic identities or metrics so normalized vectors no longer
  represent the intended thresholds.
- A stable AST-backed function identity is available and per-function monotonicity
  is worth the additional migration and rename contract.

## ADR: Review contract authoring uses one fail-closed runtime authority

Status: Accepted

Decision:

- Keep `reviewEvidenceManifestSchema.validate()` as the final manifest authority.
  JSON Schema remains a distributed structural/editor aid and explicitly does
  not own graph, candidate, lineage, or runner semantics.
- Expose `review contract validate --manifest <path>` as a side-effect-free
  authoring check. It reads through the same stable regular-file and runtime
  validator path as import, but does not resolve or mutate the runtime store,
  execute providers, create lineage, or invoke a semantic host.
- Expose `review contract init [--output <path>]` as an exclusive-create,
  repo-bounded scaffold operation. The scaffold is valid schema v2 but contains
  one high-risk unsupported cell, so it remains ineligible for semantic review
  until a project owner replaces it with real behavior and evidence providers.
- Distribute the canonical guide, one public local-gate example, and both JSON
  Schemas with Claude and Codex authoring surfaces. Installed help reports their
  exact paths.
- Do not infer frameworks, commands, risk, applicability, evidence level, or
  authorization. Do not add a preset catalog or another manifest validator.

Why:

`review/code` correctly fails closed without a resolvable contract, but an
installed user in another repository previously had no supported path to learn,
create, or dry-run validate the first manifest. Internal fixtures and repository
manifests were not public examples, and the source-only JSON Schema could accept
some inputs that the runtime rejected. A blocking scaffold plus the production
validator closes the onboarding gap without fabricating project knowledge or
weakening completion authority.

Consequences:

- A successful authoring validation proves only contract validity. Its output
  states that no evidence ran and no completion authority exists.
- `init` may create one new repository file but cannot overwrite, escape the
  canonical Git repository, import state, or start review.
- Safety-critical local conditions shared by JSON Schema and runtime are kept in
  a representative conformance corpus. Runtime-only graph rules remain
  explicitly documented rather than represented by a second incomplete
  implementation.
- Installed-distribution drift now includes the guide, example, and Schemas.

Revisit triggers:

- Multiple real projects demonstrate repeated, identical provider contracts
  that justify a curated preset with a named owner and compatibility policy.
- The manifest model moves to a declarative source capable of generating both
  the runtime validator and JSON Schema without losing graph semantics.


## 2026-09-08 — CI owns Goldband's macOS sandbox self-tests

Supersedes the self-test execution choice in “Same-host execution for
provider-owned review evidence”; other local evidence boundaries remain.

The named host lane still wrapped each test process in the runtime's Seatbelt
profile. Tests creating a different inner profile failed with `sandbox_apply`,
and installed-runtime tests lost their temporary environment inside the sealed
runtime, failed with EPERM and timed out. Identical nested profiles can work,
but the actual tests require different profiles; broadening individual allowed
operations did not provide a valid boundary for these tests.

Use the existing public `push dev` macOS CI job for the three existing provider
operations. Add explicit steps before candidate build scripts, keep the full
workflow suite, and read only exact commit/tree/run/attempt/step metadata through
a fixed GitHub API adapter. The trusted runtime pins the entire workflow recipe.
GitHub's native commit tree is checked as well as local Git to reject replacement
objects or a misleading local HEAD. No new runner service, token handling,
evidence upload, caller-supplied JSON, or unsandboxed local fallback is added.

This explicitly accepts trusted writable CI execution for these self-tests;
it does not attest an immutable checkout, exit code, network denial, or overall
pipeline success. Non-success or unavailable metadata stays runtime-incomplete.
The operation network field does not grant the consumer candidate-controlled
network actions; the CI workflow owns its network environment. Only the three
unchanged operations have a one-way transport migration. Existing signed
receipts, finding IDs and closure obligations remain authoritative.

Consequences: uncommitted candidates cannot obtain CI evidence, and a changed
workflow requires a reviewed runtime recipe update. Local unit and installed
fixture tests validate the adapter but cannot substitute for a live candidate
CI run. Both existing installers bundle the shared consumer and guide.
