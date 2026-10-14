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
- Bun below 1.3.11 is unsupported for setup and the full runtime suite.
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
Goldband keeps portable engineering workflows and owns no Unity-specific project
skill pack.

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
- Semantic properties defined by `semantic-review-criteria` belong to
  independent code review. They are not
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
  assets. A Codex plugin can package a portable subset, such as skills, MCP
  config, and app or workflow integrations.
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

- `SessionStart`, `SessionEnd`, `PreCompact`, and `PostCompact` are not registered.
  `PostToolUseFailure` is silent except for a failed Goldband review command;
  its advisory points to the installed launch contract without retrying or changing permissions.
- Hook events with no implementation are not registered merely to display a
  status message.
- Context restore remains an explicit Goldband workflow. Starting or resuming
  an unrelated session does not imply that restoration is needed.
- Prompt routing requires a capability-specific trigger; generic words do not
  activate review guidance.
- Hooks do not estimate context saturation; tool-call counts do not measure
  actual context usage.
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
- A real host call and a complete review pass each default to twelve minutes.
  Validated CLI overrides may narrow or extend them within 60 to 1800 seconds;
  the host-call timeout cannot exceed the pass timeout.

Assumptions:

- Codex and Claude continue to honor selected skill contracts and can execute
  the installed `bin/goldband` launcher.
- The workflow installer keeps `.installed-source` authoritative for copied
  minimal runtimes.
- Real host review remains read-only and structured through the existing host
  adapters.

Consequences:

- Interactive review uses deterministic diff collection, typed finding
  validation, and runtime evidence.
- A review pass fails at its deadline instead of running unbounded; timeout
  telemetry makes later tuning evidence-driven.
- Hosts outside Codex and Claude continue to use their supported prompt path
  until they gain a real typed adapter.

Alternatives considered:

| Alternative | Why rejected |
|-------------|--------------|
| Keep the thin skill as a manual checklist | Leaves runtime entry, scope, and evidence dependent on model discretion. |
| Launch the runtime from a prompt-routing hook | Generic review hints can fire for explanatory questions and are not the owner of long-running model subprocesses. |
| Put a raw `bun workflows/run.ts` command in every installed contract | Couples prompt surfaces to source layout and breaks copied minimal runtimes. |
| Silently fall back when the launcher fails | Produces a review that looks complete without typed runtime evidence. |
| Keep a two-minute timeout | The measured real Codex pass exhausted it before producing findings. |
| Give every review a thirty-minute timeout | Makes ordinary review stalls too slow to diagnose and hides prompt or dispatch regressions. |

Failure signals:

- `$goldband review code` returns findings without a real-host runtime report or
  artifacts.
- A runtime-owned reviewer starts another `goldband review code` process.
- A copied installation cannot resolve the executable workflow source.
- Launcher failure is followed by an untyped manual approval.
- Review repeatedly exhausts the twelve-minute host-call or pass budget.

Revisit triggers:

- Codex or Claude provides a native skill-to-executable binding that removes
  the need for a prompt-directed launcher.
- A host supports typed review directly without spawning its CLI adapter.
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

- `$goldband review code` never requires an escalation that the session's
  `approval_policy=never` rejects.
- Updating Goldband must rebuild the trusted snapshot; source edits alone do
  not change the admitted executable until reinstall.
- The install adds the bundled workflow entrypoints and review assets under
  `~/.codex/goldband`.

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

## 2026-07-22: Review Runs Exactly One Core Reviewer

Decision: every `review/code` run launches exactly one core reviewer, and the
review owner has no specialist dispatch path. The public launcher rejects
`--specialists` with every value before it leases scope or starts a child; the
internal `workflows/run.ts` treats it as an unknown argument.

Why: a specialist is another full host-model call with its own copy of the
complete diff, and automatic routing cannot authorize that cost. The core
reviewer already receives the complete shared rubric in one repository context.

Consequences: one reviewer may miss an issue an independent second opinion
would find. Independent second opinions need a separate, explicit capability
with its own cost contract; they are not a hidden mode of ordinary review.

Failure signals:

- A `review/code` path makes more than one host invocation.
- `--specialists` reaches diff collection or host dispatch.

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

Decision: a Work Map ticket, managed worktree lease, verification receipt, and
integrated commit are bound through stable IDs and SHA-256 digests. The Work Map
store is the only ticket-transition owner. Semantic review reports are
independent of this chain and never advance a ticket.

Implementation contract:

- A bound managed worktree can claim only an active frontier ticket and records
  the Work Map ID/revision, ticket ID, lease ID, and ticket-contract digest.
- `goldband-work-verify` executes command argument arrays without shell
  interpolation. It stores a bounded redacted summary and full-output digest,
  enforces verification-mode rules, and advances a successful ticket to
  `implemented`.
- TDD evidence requires a failing RED with an expected signal followed by a
  successful GREEN on the same declared seam. A changed candidate invalidates
  the current receipt, and records from an earlier claim attempt cannot satisfy
  a new receipt.
- Existing-test tickets persist the exact planning command argument array and
  reject substitute commands, even when the substitute exits successfully.
- Analysis-only tickets complete by recording a normalized named artifact in
  broker-owned state; they have no code worktree.
- Bound `worktree finish` reads the lease, map, ticket, receipt, and current
  candidate, integrates only a matching chain, and records the integrated commit
  and final status through the Work Map store. Readback retries revision CAS
  conflicts caused by unrelated map updates and refuses to overwrite a different
  recorded commit.
- Standalone managed worktrees remain supported but emit no Work Map evidence.

This is an evidence-integrity and workflow gate, not a security boundary
against a user or process with the same host account and filesystem access.

Failure signals:

- Evidence from another map, ticket, lease, base commit, or candidate is reused.
- RED proves an unrelated failure or GREEN has no earlier matching RED.
- A successful command different from the planning command is accepted.
- An analysis-only ticket has no named-artifact completion path.
- A review report changes Work Map state.
- Finish checks only ticket status and ignores receipt provenance.
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

- `knowledge` exposes only `recall`, and the supported host list excludes
  GBrain.
- Goldband does not read, write, install, upgrade, health-check, or uninstall
  user-owned GBrain assets.
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

## ADR: Review scope uses canonical repository coordinates

Decision: `review/code` resolves the canonical Git repository root and the
invocation-relative offset once. Diff paths, changed files, the scope digest,
snapshots, and the dependency projection use repo-root coordinates, so root and
tracked-subdirectory invocations review the same repository scope. An invocation
directory outside the canonical repository fails.

Why: mixing repo-root patch paths with subdirectory-relative snapshots produced
inconsistent review scope.

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

## 2026-09-15: Review input is bounded at 2 MiB

Decision: one runtime constant bounds the complete review patch at 2 MiB,
including combined tracked and untracked input; prompt metadata overhead is
bounded separately at 48 KiB. Oversized input fails explicitly and asks for a
narrower scope. There is no project exception, waiver, or silent truncation.

Why: a 256 KiB budget rejected complete worktree diffs that could not be split
without losing the requested review. The ceiling allows higher review cost and
is not a token-window guarantee; revisit input packaging if real host context
failures show complete input at this size is impractical.

## 2026-10-11: Retire review evidence governance and closure authorization

Keep one independent semantic review pass, shared rules, related-code context,
concrete findings, native read-only permissions, and honest report boundaries.
Remove review manifests/providers, registry authoring, signed receipts, acceptance
lineage, evidence repair, and closure/completion authorization. Their maintenance
burden is established; additional defect-detection value beyond project checks
and semantic review has not been demonstrated. This supersedes earlier review
evidence and closure decisions, including their automatic continuation contracts.

Project tests and CI remain project-owned. Work Map delivery uses existing project
verification and explicit Git integration; semantic reports do not gate or mutate
it. Analysis-only delivery is recorded with its declared artifact. Historical
state remains readable but retired review references confer no authority.

The tradeoff is explicit: Goldband enforces no signed proof chain and does not
track unresolved review findings. Reviewers and implementers must still report
what was checked and what remains unverified. Installs replace obsolete runtime
assets; historical external records are preserved.

Keep the repository-and-scope execution lease as duplicate-call cost control,
including shared coordination when report storage uses a temporary directory.
It does not inspect evidence or authorize completion. Claude installation also
retains the minimal trusted runtime configuration (`schemaVersion`, `runtimeHost`)
to pin runtime selection and host identity; obsolete receipt fields are removed
on both copied and same-directory reinstalls.

## 2026-10-12: Share hook policy without requiring identical host automation

Secret classification and shell command extraction have one source under
`hooks/scripts/lib/hook-router/`; the existing distribution generator emits
Codex copies and the Claude plugin. Host adapters own input/output conversion.
Documentation naming and dev-server process choices are guidance, not denial
policies. Tool writes have no path-only secret exemption; removed patch lines
are excluded so cleanup remains possible. Host-specific modes and automation
remain explicit in `ARCHITECTURE.md` rather than being copied for symmetry.

Command extraction preserves explicit code and input/output edges. Shared policy
evaluation also scans unknown launchers for signatures requiring both a command
name and specific arguments, without requiring an exhaustive wrapper registry.
Name-only rules (`env`, `printenv`, `sudo`, `gparted`) apply only at
actual command positions, including extracted child commands; arguments such
as an `env` directory or a `sudo` query target cannot activate them. Known data
consumers keep their argument boundaries. Codex's formatting rule treats `mkfs`
and `mkfs.*` as one family. Actual commands block on a literal `/dev/...`
argument or any argument containing `$`; unknown-launcher candidates require
the literal device argument. The dollar-sign rule is conservative, including
quoted literal dollars and non-target arguments, without variable expansion.
A name or help query alone does not match this rule. Literal image files remain
allowed. The policy also covers `mke2fs`, `newfs_apfs`, and destructive `wipefs`
options; it preserves known wipefs listing/no-act and fdisk list operations.
Wipefs long options accept their native unambiguous abbreviations.
Fdisk's list exception checks Linux and macOS option meanings without assuming
the local OS is the execution target. A macOS write cannot gain that exception
from a list-shaped geometry value or MBR template filename.
Option values are not flags: `wipefs -t -n` must not activate a no-act exemption.
Codex also recognizes the `git push -f` alias, while a push-option value `-f`
does not count as force. These are policy decisions; shell syntax stays frozen.
Explicit SSH remote command strings are code for both hosts. Ambiguous unquoted
signatures are conservatively rejected. Extraction or evaluation errors,
including stack overflow, exceeded work limits, or unresolved descriptor and
literal-output transformations needed by shell/SQL consumers, return native
denials rather than an unchecked hook error. Native permissions remain
execution authority.
Shared regression inputs state each host's expected result separately.

The false-positive cost is explicit: harmless input is denied when its output
transformation is unsupported. This affects Codex's default-on high-risk policy
and Claude's opt-in careful mode. The cost is accepted instead of supporting
more output formats or shell syntax. Parser capabilities are frozen at the documented scope;
the hook is a bounded heuristic, not an authorization boundary.

## 2026-10-12: Preserve Shared Host Settings and Make Status Lines Optional

The main Codex config and Claude settings belong to the user. This supersedes
value ownership in the 2026-07-21 Codex config freshness decision.

- Codex merges portable and local defaults only when the main config is absent.
  Existing files are validated but kept byte-for-byte, including omitted keys,
  comments, and runtime state. A deleted preference stays omitted. Later defaults
  do not propagate automatically; no per-machine ownership registry is introduced.
- Status validates TOML rather than equality with a template. It separately advises
  manual review of `shell_environment_policy` differences. This table (including
  `exclude`) is a recommendation, not enforced policy. The optional requirements
  install constrains only approval policies/reviewers, sandbox modes, and web search
  modes; it does not enforce environment-variable exclusions. Native rules and hooks
  remain separately installed controls, not a substitute for that missing boundary.
- Config operations require Python 3.11+ tomllib. Invalid input or unavailable
  parsing preserves the file. Core/full installs still process independent agents,
  hooks, rules, profiles, skills, and launchers, then report a nonzero partial result.
- The reserved `goldband.rules` portable baseline updates after backing up an old
  copy, including installations without symlink support. Personal approvals in
  `default.rules` remain untouched.
- Claude retains the user's model, permission mode, custom hooks, and status line.
  Optional status-line targets replace only their own setting, never unrelated
  defaults. Explicit Codex status-line edits can normalize TOML and remove comments;
  ordinary installation and background refresh never do so.
- Both hosts back up changed personal settings before atomic replacement, retaining
  `.bak` and `.bak.previous`. No-op operations do not rotate backups. Historical
  backups from earlier installers are not deleted automatically.
- Uninstall preserves the shared Codex config, personal rules, custom Claude hooks,
  and non-Goldband status lines. It removes recognized Goldband hooks, exact known
  status-line commands, source links, and matching copies; modified/unknown files
  remain. Named profiles reuse the existing ownership comparison, ignoring host
  runtime state while preserving changed preferences. Unreadable Claude settings or
  missing jq retain those settings and referenced assets, but do not block independent
  Codex removal; uninstall returns a nonzero partial result.

`npm run test:config-preservation` covers both hosts, local Git updates, omitted
preferences, invalid input, parser failure, independent component refresh, status
advice, status-line scope, backup retention, and uninstall ownership. Config
validation, real execpolicy checks, and independent review remain separate evidence.

## 2026-10-12: Hosts Own Skill Selection

Claude Code and Codex select skills and the `goldband` capability router from
each `SKILL.md` description. Goldband prompt hooks do not match prompt keywords
to suggest portable skills or `$goldband` capabilities. This removes
`activation-rules.js`, the generated `capability-routing.generated.json` files,
the Codex suggestion session state, and the manifest `triggers` field.

Why: the keyword matcher duplicated native routing, added context, and missed
cases it claimed to cover. Description quality is the single
routing input to maintain.

The Claude `UserPromptSubmit` hook keeps cross-review arming, the knowledge
advisory, and workflow-entry telemetry; the Codex prompt hook keeps
cross-review arming. `prompt-trigger` remains a valid telemetry category so
older JSONL still validates. `scripts/test-hook-noise-policy.mjs` asserts that
task-shaped prompts produce no routing context on either host.

## 2026-10-12: Telemetry Has No Upload Path

Goldband Loop telemetry stays on the local machine. The inherited Supabase
backend is removed: `goldband-loop/supabase/` (edge functions, migrations,
project config), `goldband-telemetry-sync`, the background sync started by
`goldband-telemetry-log`, and the install ping in `goldband-update-check`. The
`telemetry` tiers remain valid config values but only control the local usage
log.

Why: the configured project was inherited, not verifiably owned by this
repository, so enabling a non-`off` tier could send usage data to a third
party. Keeping an unowned upload path is riskier than removing it. Manual OTLP
export to a user-chosen endpoint is unchanged. GitHub version checks in
`goldband-update-check` remain governed by `update_check`.

## 2026-10-12: Goldband Commands Do Not Shadow Host Commands

Claude Code resolves a user command over a built-in or bundled command with the
same name. `commands/plan.md` is renamed to `commands/goldband-plan.md`, and
`commands/verify.md` is removed in favor of the host's `/verify`; its guidance
already lives in `rules/claim-verification.md` and the global instructions.
New Goldband commands use the `goldband-` prefix unless no host command can
share the name.

## 2026-10-13: Retire the Goldband Browser in Favor of Host Browser Tools

`goldband-loop/browse` (the persistent Chromium daemon, its Chrome extension and
side panel, browser skills, the macOS browser app, `chrome-cdp`, and the
prompt-injection classifier) is removed. The `browser/session` action and its
`browser/cookies` safety gate do not exist; the Codex launcher stages no browser
client and auto-admits no browser commands. Browser work, including real
`qa/app` QA, uses the active host's browser tool under `manuals/browser.md`.
`mcp/` templates define a Playwright MCP entry pinned to
`@playwright/mcp@0.0.83` with `--isolated` and a localhost-only
`--allowed-origins` default. `make-pdf` keeps its feature and now drives
Chromium directly through Playwright (`make-pdf/src/pdfRenderer.ts`).

Why: on 2026-10-12 the three QA fixtures (15 seeded bugs, now under
`goldband-loop/test/fixtures/qa-eval*.html`) were run with `browse` and with
Playwright MCP. Playwright MCP found 15/15 and passed every capability probe
(HttpOnly session, dialogs, upload, iframe, popup tabs, PDF). `browse` found
14/15 because it never captured uncaught page exceptions, and it missed popup
tabs. Keeping roughly 66k lines of browser runtime for no QA capability the
hosts lack is not justified. Claude in Chrome was not measured because its
extension was disconnected.

Trade-off: page content from Playwright MCP is not wrapped as untrusted or
scanned by a classifier. Protection against injected instructions rests on what
the agent may do afterwards (native permissions, auto-mode review, sandboxing,
and the approval rules in `manuals/browser.md`), plus the template's isolation
and origin defaults. Playwright documents `--allowed-origins` as not a security
boundary. On Windows `make-pdf` runs the Chromium job in a Node child process,
because Bun 1.3 there cannot launch Chromium (oven-sh/bun#4253) and cannot use
`chromium.connect` on any platform; the Windows CI job renders a real PDF to
prove that path.

`./install.sh all-with-workflow` adds that entry to Claude Code (`claude mcp add
--scope user`) and Codex (an appended `[mcp_servers.playwright]` table), because
`qa/app` cannot exercise a page without a browser tool and the Chrome extension
is not always connected. It reads the template, never modifies an existing
`playwright` entry, and honors `GOLDBAND_SKIP_PLAYWRIGHT_MCP=1`. Only that
explicit target adds it; `auto-refresh` replays component targets, so a user
who removes the entry keeps it removed. `codex mcp add` was rejected because it
re-renders the whole user config. The template also sets `--output-dir` to a
`/path/to/goldband-home` placeholder that the installer resolves to an
absolute `$GOLDBAND_HOME/playwright-mcp`: without it Playwright MCP writes a
`.playwright-mcp/` directory into the project, and the option does not expand
`~`. `--output-max-size=5242880` uses Playwright MCP's own eviction instead of
a goldband cleanup job. It is a threshold, not a hard cap: after each tool
response, `_enforceOutputBudget` in 0.0.83 deletes the oldest earlier files
until the directory is under 5 MB and never deletes that response's own files.
Recent snapshots persist until evicted, so the README tells users to delete the
directory after testing sensitive data. `--snapshot-mode none` was rejected
because the agent needs page snapshots to do QA.

The accepted trade-off is that a long session can evict a screenshot or
snapshot an earlier response returned, so the agent may find that path gone and
must capture it again. On the QA fixtures a PNG screenshot measured 19-44 KB and
a page snapshot about 4 KB, so 5 MB holds well over a hundred captures there;
image-heavy pages, estimated (not measured) at a few hundred KB per screenshot,
still leave room for roughly ten to twenty. No full `qa/app` session has been
measured against the threshold.

## 2026-10-13: Review Findings Are Typed and Every Valid Finding Blocks

Decision: findings carry `kind: "defect" | "improvement"`. A defect needs
evidence, a failure scenario, and verification. An improvement records an
adoptable design change without a reachable failure; it needs evidence and a
recommendation and is `medium`, `low`, or `info`. Every valid finding blocks:
the runtime forces an improvement's `blocking` to `true`, reports all valid
findings after deduplication, and counts both kinds in the review signal, so a
review is clean only when none remain. An invalid improvement is discarded with
a reported reason; kind and severity are never reclassified. One
`review-engine.ts` operation owns validity, deduplication, and ordering. The
rubric Suppressions exclude pure style, consistency-only changes, and
unsupported advice.

Rule selection and prompt assembly use the changed paths collected with the
diff; no consumer re-parses it.

Why: an advisory improvement is easily left behind as design debt, and a
display cap discarded findings the reviewer had already produced. A second diff
parser dropped a path-routed rule for a Git-quoted path.

## 2026-10-13: First-Party Exports Outside Knip Need a Consumer

Decision: `scripts/check-unused-exports.mjs` fails when a first-party module in
`hooks/`, `codex/hooks/`, `scripts/`, `goldband-loop/cross-review/`, skill
scripts, or `mcp/server/src/` exports a name that no other first-party source
file mentions. It runs in the pre-commit project style gate for any staged
source file, in `npm test` as `root:unused-exports`, and in the validate
workflow. `goldband-loop` TypeScript stays with its existing knip check.

knip was tried on these directories and rejected: it does not see members used
through `const core = require(...); core.name(...)` or modules loaded by path
at runtime, so it reported mostly false positives. The dedicated check parses
`module.exports = { ... }` and ESM `export` declarations and counts any
identifier mention in another tracked source file as a consumer, including
tests. Generated copies listed by `managedGeneratedFiles()` and `plugin-assets/`
are neither checked nor counted, and `hooks/fixtures/` is excluded.

The check is deliberately lenient: a common name mentioned elsewhere counts as
used, and an export that tests import without exercising still passes. It
guards against orphaned exports, not against dead code that review must judge.
