# TODOS

Completed work is kept in [`docs/archive/TODOS_COMPLETED.md`](docs/archive/TODOS_COMPLETED.md).

## design daemon: follow-ups (filed v1.45.0.0 via release review)

### P3: Minor maintainability nits from release review

- `design/src/cli.ts` and `design/src/serve.ts` both have a small `openBrowser`
  helper with identical darwin/linux/else branches. Extract a shared
  `design/src/open-browser.ts`.
- `design/src/daemon-client.ts:320` (`AbortSignal.timeout(2000)`) and `:357`
  (`delay(50)`) use bare numeric literals while sibling timeouts are named
  constants. Promote to `SHUTDOWN_POST_TIMEOUT_MS` and `ALIVE_POLL_INTERVAL_MS`.
### P3: Daemon scope deferred from v1.45.0.0 plan

Originally listed in the plan's "TODOs surfaced for later" section:

- Per-daemon scoped auth tokens (only relevant once a tunnel/share use case appears).
- Optional persistent board history on disk in
  `~/.goldband/projects/$SLUG/designs/history/` so submitted boards survive
  daemon restarts.
- Windows spawn branch lifted from browse (V1 daemon is macOS + Linux;
  Windows users fall back to legacy `--no-daemon` per-process server).
- `$D board list` / `$D board stop <id>` per-board ops CLI (V1 has only
  `$D daemon status` / `stop`).
- Cross-worktree daemon attach (conductor sibling worktrees of the same
  repo currently each spawn their own daemon — matches browse; revisit
  if it causes friction).

---

## browse server: terminal-agent teardown follow-ups (filed v1.41 via /plan-eng-review)

### P3: shutdown() reads module-level `config`, not `cfg.config` (composition gap)

**What:** `browse/src/server.ts:shutdown()` reads `path.dirname(config.stateFile)`
where `config` is the module-level value resolved at import time, not the
`cfg.config` passed into `buildFetchHandler`. Same gap applies to
`cleanSingletonLocks(resolveChromiumProfile())` at server.ts:1298 — should
read `cfg.chromiumProfile`.

**Why:** Embedders today happen to share state-dir resolution with the CLI
(both go through `resolveConfig()` against the same env), so this doesn't
bite. But if an embedder ever passes a divergent `cfg.config` (e.g., a test
harness pointing at a temp dir), shutdown will operate on the wrong paths.
The `ownsTerminalAgent` flag exposes the problem without fixing it.

**Pros:** Closes the embedder-composition story properly. Pairs with
`cfg.chromiumProfile` to give a single coherent "this factory teardown
respects cfg" contract.

**Cons:** Pre-existing — not a regression. Two call sites today (1285 for
terminal files, 1298 for chromium locks). Threading `cfg.config` and
`cfg.chromiumProfile` into the right closures is straightforward but
broader than the v1.41 fix.

**Context:** Flagged by both Codex and Claude subagent in the /plan-eng-review
dual voices. Documented as out-of-scope in the v1.41 plan; same shape as the
`chromiumProfile` PR-body note to the gbrowser team.

**Depends on:** None.

---

### P3: Ownership-object refactor if a 4th caller-owned teardown gate appears

**What:** Today `ServerConfig` has three caller-owned teardown gates:
`xvfb?` (presence ⇒ don't close), `proxyBridge?` (same), and now
`ownsTerminalAgent` (explicit boolean). If a 4th gate appears, collapse to
`cfg.callerOwns?: Set<'terminalAgent' | 'xvfb' | 'proxyBridge' | ...>` or
similar.

**Why:** Three independent flags is below the refactor threshold — each
field has clear, distinct semantics and the JSDoc voice is consistent. A
fourth tips the cost balance: the per-field surface gets noisy, and
"what does this factory own?" becomes a question you have to ask of three
or four scattered fields instead of one explicit set.

**Pros:** Single source of truth for "what goldband tears down". Trivial
extension surface for future caller-owned resources. Easier to assert in
tests ("the set should contain X, not Y").

**Cons:** Premature today. The polarity-inversion note in the
`ownsTerminalAgent` JSDoc only hurts a little — it's one anomaly, not a
pattern. Refactoring now to an ownership object would touch every embedder.

**Context:** Recommended by Claude subagent during /plan-ceo-review dual
voice (autoplan). Trigger: a 4th caller-owned teardown gate in this same
`ServerConfig` shape.

**Depends on:** A 4th gate to motivate the refactor.

---

## Browser skills

Browser-skill runtime, fixture staleness, and OS sandbox follow-ups must be implemented in browser runtime code and deterministic tests. Workflow discovery stays behind the manifest capability interface; do not inject skill lists into a universal prompt.

### P2: Migrate `/learn` to SQLite

**What:** The current `~/.goldband/projects/<slug>/learnings.jsonl` storage works (append-only, tolerant parser, idle compactor) but Codex outside-voice (T5) flagged JSONL as "the wrong primitive" for multi-writer canonical state: lost-update on rewrite, partial-line corruption on crash, no transactions. v1.8.0.0 hardened JSONL with flock + O_APPEND but the right long-term primitive is SQLite (which Bun has built in via `bun:sqlite`).

**Why:** Domain skills now live in the same `learnings.jsonl` (per CEO D1 unification). As volume grows, the JSONL hardening compactor + tolerant parser approach becomes the long pole. SQLite gives atomic transactions, indexes (huge for hostname lookup), and crash-safety without a custom compactor.

**Pros:** Atomic writes. Real schema. Fast indexed lookups by hostname/key/type. Crash-safe.

**Cons:** Migration touches every consumer of `learnings.jsonl` — `/learn` scripts (`goldband-learnings-log`, `goldband-learnings-search`), domain-skills.ts read/write, and provider-neutral artifact sync. Old `learnings.jsonl` files in the wild need a one-shot migration script.

**Context:** The JSONL hardening in v1.8.0.0 was the right call for that release scope (preserve unification, not high-scope). But the failure modes are bounded, not eliminated. SQLite is the high-scope fix.

**Effort:** M (human: ~1 week / CC: ~1 day)
**Priority:** P2
**Depends on:** v1.8.0.0 in production for ~1 month to measure JSONL pain (compactor frequency, partial-line drops, write contention).

---

### P3: Replay/record demonstrated flows to domain-skills

**What:** Watch a human drive a site once (record DOM events + screenshots + nav), generalize to a domain-skill. "Teach by showing." Different research dream than v1.8.0.0's per-site notes.

**Why:** The highest-quality skill content is one a human demonstrated, not one the agent figured out from scratch. Pairs with skillpack publishing — recorded flows are the most valuable packs.

**Pros:** Skill quality jumps. Some sites are too complex for an agent to figure out alone (multi-step OAuth, captcha-gated forms).

**Cons:** Record fidelity vs. selector stability over time. DOM changes break recordings. Real research needed.

**Context:** Browser-use has experimented with this. Playwright has a recorder. Codeception/Cypress recorders exist. None of them do the "generalize the recording into a markdown note" step.

**Effort:** L (human: ~2-3 weeks / CC: ~2-3 days)
**Priority:** P3
**Depends on:** Probably its own `/office-hours` session before committing eng time.

---

### P3: `$B commands review` batch-mode UX

**What:** Originally an alternative for the inline-on-first-use approval gate (DevEx D6 alternative C). Instead of approving each agent-authored command at first invocation, batch them: agent scaffolds many, human reviews `$B commands review` at a convenient time, approves/rejects in one pass.

**Why:** If self-authoring commands ever ships (the P1 above), the inline approval at first-use can interrupt the agent mid-task. Batch review is friendlier for the human.

**Pros:** Reduces interrupt frequency. Lets humans review with full context.

**Cons:** Defers approval — agent can't use the new command until the human comes back. If the agent needs the command immediately, this is worse than inline.

**Context:** Tied to the P1 above. Won't ship before that does.

**Effort:** S (human: ~half day / CC: ~30 min)
**Priority:** P3
**Depends on:** P1 self-authoring `$B` commands.

---

### P3: Heuristic command-gap watcher

**What:** Sidebar-agent watches the activity feed; when an agent repeats a similar action 3+ times (e.g., calls `$B js` with structurally similar arguments), suggest scaffolding a command. From DevEx D4 alternative C.

**Why:** Closes the discoverability loop on self-authoring commands. Agent is most likely to write a command when it just hit the same friction multiple times.

**Pros:** Surgical. Fires only when a command would have demonstrably helped. Uses real telemetry, not heuristics.

**Cons:** False positives (legitimate repeated actions) feel intrusive. Hard to design without telemetry first.

**Context:** Telemetry from v1.8.0.0 (`cdp_method_called`, `cdp_method_denied` counters) gives us the data to design this well. Don't design until we have ~1 month of production data.

**Effort:** M (human: ~1 week / CC: ~1 day)
**Priority:** P3
**Depends on:** v1.8.0.0 telemetry in production. P1 self-authoring commands.

---
## Sidebar Terminal (cc-pty-import follow-ups)

### v1.1: PTY session survives sidebar reload

**What:** Today the Terminal tab's PTY dies with the WebSocket — sidebar
reload, side-panel close, even a quick navigate-away in another tab close
the session. v1.1 should key the PTY on a tab/session id so a reload
reattaches to the existing claude process and you keep `/resume` history.

**Why:** Mid-task resilience. When you've been pair-programming with claude
for 20 minutes and an accidental Cmd-R blows it away, the cost is real.

**Pros:** Better UX, fewer interrupted sessions. **Cons:** Session-tracking
state, ghost-process risk, lifecycle bugs (when DOES the PTY actually go
away?). v1 chose the simple "PTY dies with WS" model deliberately.

**Context:** /plan-eng-review Issue 1C decision (cc-pty-import branch,
2026-04-25). v1 ships with phoenix's lifecycle. **Depends on:**
cc-pty-import landed.

**Priority:** P2 (nice-to-have).
**Effort:** M. Likely needs a per-tab session map keyed by chrome.tabs.id
plus a TTL so abandoned PTYs eventually exit.

---

### v1.1+: Audit `/health` token distribution

**What:** Codex's outside-voice review on cc-pty-import flagged that
`/health` already surfaces `AUTH_TOKEN` to any localhost caller in headed
mode (`server.ts:1657`). That's a pre-existing soft leak — anything
running on localhost gets the root token by hitting `/health`.

**Why:** cc-pty-import sidesteps it by NOT putting the PTY token there
(uses an HttpOnly cookie path instead). But the underlying leak is still
shippable surface. A second extension or a localhost web app could
currently scrape `AUTH_TOKEN` and hit any browse-server endpoint.

**Pros:** Closes a real privilege-escalation path on multi-extension
machines. **Cons:** Either we tighten the gate (Origin must be OUR
extension id, not just any chrome-extension://) or we move bootstrap
discovery off `/health` entirely. Either has migration cost for tests
and the existing extension.

**Context:** codex finding #2 on cc-pty-import plan-eng review. Not in
scope of that PR; deliberately deferred to keep PTY-import small.

**Priority:** P2.
**Effort:** M.

---

 ## Context skills

### `/context-save --lane` + `/context-restore --lane` for parallel workstreams

**What:** Let users save and restore per-workstream (lane) context independently. On save: `/context-save --lane A "backend refactor"` writes a lane-tagged file. Or `/context-save lanes` reads the "Parallelization Strategy" section of the most recent plan file and auto-generates one saved context per lane. On restore: `/context-restore --lane A` loads just that lane's context. Useful when a plan has 3 independent workstreams and the user wants to pick one up in each of 3 Conductor windows.

**Why:** Plans produced by `/plan-eng-review` already emit a lane table (Lane A: touches `models/` and `controllers/` sequentially; Lane B: touches `api/` independently; etc.). Right now there's no way to transfer that structure into resumable saved state. Users manually re-describe the scope in each window. Lane-tagged save/restore would be the bridge between "here's the plan" and "three people (or three AIs) are now working in parallel on it."

**Pros:** Turns `/plan-eng-review`'s parallelization output into actionable resume state. Reduces context-loss across Conductor workspace handoffs for multi-workstream plans.

**Cons:** Net-new functionality (not a port from the old `/checkpoint` skill). The "spawn new Conductor windows" part needs research into whether Conductor has a spawn CLI. Also requires lane-tagging discipline in the save step (manual or extracted).

**Context:** The lane data model should be owned by the `plan/engineering-review` runtime contract (the "Parallelization Strategy" output with Lane A/B/C dependency tables and conflict flags). Deferred from the v0.18.5.0 rename PR so the rename could land as a tight, low-risk fix. Saved files currently live at `~/.goldband/projects/$SLUG/checkpoints/YYYYMMDD-HHMMSS-<title>.md` with YAML frontmatter (branch, timestamp, etc.). The lane feature would add a `lane:` field to frontmatter and a `--lane` filter to both skills.

**Effort:** M (human: ~1-2 days / CC: ~45-60 min)
**Priority:** P3 (nice-to-have, not blocking anyone yet)
**Depends on:** `/context-save` + `/context-restore` rename stable in production (v1.0.1.0+). Research: does Conductor expose a spawn-workspace CLI?

## Personalization follow-up

Any future personalization must be an explicit, inspectable runtime or user-config feature. Do not inject psychographic adaptation, blind-spot coaching, or pacing policy into every workflow prompt.

## Browse

### Scope sidebar-agent kill to session PID, not `pkill -f sidebar-agent\.ts`

**What:** `shutdown()` in `browse/src/server.ts:1193` uses `pkill -f sidebar-agent\.ts` to kill the sidebar-agent daemon, which matches every sidebar-agent on the machine, not just the one this server spawned. Replace with PID tracking: store the sidebar-agent PID when `cli.ts` spawns it (via state file or env), then `process.kill(pid, 'SIGTERM')` in `shutdown()`.

**Why:** A user running two Conductor worktrees (or any multi-session setup), each with its own `$B connect`, closes one browser window ... and the other worktree's sidebar-agent gets killed too. The blast radius was there before, but the v0.18.1.0 disconnect-cleanup fix makes it more reachable: every user-close now runs the full `shutdown()` path, whereas before user-close bypassed it.

**Context:** Surfaced by the v0.18.1.0 release review. Pre-existing code, not introduced by the fix. Fix requires propagating the sidebar-agent PID from `cli.ts` spawn site (~line 885) into the server's state file so `shutdown()` can target just this session's agent. Related: `browse/src/cli.ts` spawns with `Bun.spawn(...).unref()` and already captures `agentProc.pid`.

**Effort:** S (human: ~2h / CC: ~15min)
**Priority:** P2
**Depends on:** None

## Sidebar Security

### ML Prompt Injection Classifier — v2 Follow-ups

#### Cache review decisions per (domain, payload-hash-prefix) (P1)

**What:** If Haiku fires on a page twice in the same session (e.g., user does Bash then Grep on the same suspicious file), the second fire shouldn't re-prompt. Cache the user's decision keyed by a per-session (domain, payloadHash-prefix) pair. Small LRU, ~100 entries, session-scoped (not persistent across sidebar restarts — we want fresh decisions on new sessions).

**Why:** Reduces review-banner fatigue when the same bit of sketchy content gets scanned multiple times via different tools. At 44% FP on v1, this matters most.

**Effort:** S (human: ~0.5 day / CC: ~20 min)
**Priority:** P1

#### Fine-tune a small classifier on BrowseSafe-Bench + Qualifire + xxz224 (P2 research)

**What:** TestSavantAI was trained on direct-injection text, wrong distribution for browser-agent attacks (measured 15% recall). Take BERT-base, fine-tune on BrowseSafe-Bench (3,680 cases) + Qualifire prompt-injection-benchmark (5k) + xxz224 (3.7k) combined, ship in ~/.goldband/models/ as replacement L4 classifier.

**Why:** Expected 15% → 70%+ recall on the actual threat distribution without needing Haiku. Would also cut latency (no CLI subprocess) and drop Haiku cost.

**Effort:** XL (human: ~3-5 days + ~$50 GPU / CC: ~4-6 hours setup + ~$50 GPU)
**Priority:** P2 research — validate the lift on a held-out test set before committing to replace TestSavant

#### DeBERTa-v3 ensemble as default (P2)

**What:** Flip `GOLDBAND_SECURITY_ENSEMBLE=deberta` from opt-in to default. Adds a 3rd ML vote; 2-of-3 agreement rule should reduce FPs while catching attacks that only DeBERTa sees.

**Why:** More votes = better calibration. Currently opt-in because 721MB is a big first-run download; flipping to default requires lazy-download UX.

**Cons:** 721MB first-run download for every user. Costs user bandwidth + disk.

**Effort:** M (human: ~2 days / CC: ~1 hour + UX)
**Priority:** P2 (after #1 tuning to see how much room is left)

#### User-feedback flywheel — decisions become training data (P3)

**What:** Every Allow/Block click is labeled data. Log (suspected_text hash, layer scores, user decision, ts) to ~/.goldband/security/feedback.jsonl. Aggregate via community-pulse when `telemetry: community`. Periodically retrain the classifier on aggregate feedback.

**Why:** The system gets better the more it's used. Closes the loop between user reality and defense quality.

**Cons:** Feedback loop can be poisoned if attacker controls enough devices. Need guardrails (stratified sampling, reviewer validation, k-anon minimums on training batch).

**Effort:** L (human: ~1 week for local logging + aggregation pipe, another week for retrain cron / CC: ~2-4 hours per sub-part)
**Priority:** P3 — only worth building after v2 tuning proves the architecture is the right shape


#### Full BrowseSafe-Bench at gate tier (P2)

**What:** Promote `browse/test/security-bench.test.ts` from smoke-200 (gate) to full-3680
(gate) once smoke/full detection rate correlation is measured (~2 weeks post-ship).

**Why:** BrowseSafe-Bench is Perplexity's 3,680-case browser-agent injection benchmark.
Smoke-200 is a sample; full coverage catches the long tail. Run time ~5min hermetic.

**Effort:** S (CC: ~45min)
**Priority:** P2
**Depends on:** v1 shipped + ~2 weeks real data

#### ~~Cross-user aggregate attack dashboard (P2)~~ — CLI retired, web UI remains

The `goldband-security-dashboard` CLI (commit 756875a7) was retired together
with `goldband-community-dashboard` and the Supabase telemetry backend.

Web UI at goldband.gg/dashboard/security is still open — that's a separate
webapp project outside this repo's scope.

#### Bun-native 5ms inference (P3 research) — SKELETON SHIPPED, forward pass open

Research skeleton landed this round (browse/src/security-bunnative.ts,
docs/designs/BUN_NATIVE_INFERENCE.md, browse/test/security-bunnative.test.ts):

  * Pure-TS WordPiece tokenizer — reads HF tokenizer.json directly, matches
    transformers.js output on fixture strings (correctness-tested in CI)
  * Stable `classify()` API that current callers can wire against today
  * Benchmark harness with p50/p95/p99 reporting — anchors v1 WASM baseline
    for future regressions

Design doc captures the roadmap:
  * Approach A: pure-TS + Float32Array SIMD — ruled out (can't beat WASM)
  * Approach B: Bun FFI + Apple Accelerate cblas_sgemm — target ~3-6ms p50,
    macOS-only, ~1000 LOC
  * Approach C: Bun WebGPU — unexplored, worth a spike

Remaining work (XL, multi-week):
  * FFI proof-of-concept for cblas_sgemm
  * Single transformer layer implementation + correctness check vs onnxruntime
  * Full forward pass + weight loader + correctness regression fixtures
  * Production swap in security-bunnative.ts `classify()` body

 ## Chrome DevTools MCP Integration

### Real Chrome session access

**What:** Integrate Chrome DevTools MCP to connect to the user's real Chrome session with real cookies, real state, no Playwright middleman.

**Why:** Right now, headed mode launches a fresh Chromium profile. Users must log in manually or import cookies. Chrome DevTools MCP connects to the user's actual Chrome ... instant access to every authenticated site. This is the future of browser automation for AI agents.

**Context:** Google shipped Chrome DevTools MCP in Chrome 146+ (June 2025). It provides screenshots, console messages, performance traces, Lighthouse audits, and full page interaction through the user's real browser. goldband should use it for real-session access while keeping Playwright for headless CI/testing workflows.

Potential new skills:
- `/debug-browser`: JS error tracing with source-mapped stack traces
- `/perf-debug`: performance traces, Core Web Vitals, network waterfall

May replace `/setup-browser-cookies` for most use cases since the user's real cookies are already there.

**Effort:** L (human: ~2 weeks / CC: ~2 hours)
**Priority:** P0
**Depends on:** Chrome 146+, DevTools MCP server installed

## Browse

### Bundle server.ts into compiled binary

**What:** Eliminate `resolveServerScript()` fallback chain entirely — bundle server.ts into the compiled browse binary.

**Why:** The current fallback chain (check adjacent to cli.ts, check global install) is fragile and caused bugs in v0.3.2. A single compiled binary is simpler and more reliable.

**Context:** Bun's `--compile` flag can bundle multiple entry points. The server is currently resolved at runtime via file path lookup. Bundling it removes the resolution step entirely.

**Effort:** M
**Priority:** P2
**Depends on:** None

### Sessions (isolated browser instances)

**What:** Isolated browser instances with separate cookies/storage/history, addressable by name.

**Why:** Enables parallel testing of different user roles, A/B test verification, and clean auth state management.

**Context:** Requires Playwright browser context isolation. Each session gets its own context with independent cookies/localStorage. Prerequisite for video recording (clean context lifecycle) and auth vault.

**Effort:** L
**Priority:** P3

### Video recording

**What:** Record browser interactions as video (start/stop controls).

**Why:** Video evidence in QA reports and PR bodies. Currently deferred because `recreateContext()` destroys page state.

**Context:** Needs sessions for clean context lifecycle. Playwright supports video recording per context. Also needs WebM → GIF conversion for PR embedding.

**Effort:** M
**Priority:** P3
**Depends on:** Sessions

### v20 encryption format support

**What:** AES-256-GCM support for future Chromium cookie DB versions (currently v10).

**Why:** Future Chromium versions may change encryption format. Proactive support prevents breakage.

**Effort:** S
**Priority:** P3

### Auth vault

**What:** Encrypted credential storage, referenced by name. LLM never sees passwords.

**Why:** Security — currently auth credentials flow through the LLM context. Vault keeps secrets out of the AI's view.

**Effort:** L
**Priority:** P3
**Depends on:** Sessions, state persistence

### Semantic locators

**What:** `find role/label/text/placeholder/testid` with attached actions.

**Why:** More resilient element selection than CSS selectors or ref numbers.

**Effort:** M
**Priority:** P4

### Device emulation presets

**What:** `set device "iPhone 16 Pro"` for mobile/tablet testing.

**Why:** Responsive layout testing without manual viewport resizing.

**Effort:** S
**Priority:** P4

### Network mocking/routing

**What:** Intercept, block, and mock network requests.

**Why:** Test error states, loading states, and offline behavior.

**Effort:** M
**Priority:** P4

### Download handling

**What:** Click-to-download with path control.

**Why:** Test file download flows end-to-end.

**Effort:** S
**Priority:** P4

### Content safety

**What:** `--max-output` truncation, `--allowed-domains` filtering.

**Why:** Prevent context window overflow and restrict navigation to safe domains.

**Effort:** S
**Priority:** P4

### Streaming (WebSocket live preview)

**What:** WebSocket-based live preview for pair browsing sessions.

**Why:** Enables real-time collaboration — human watches AI browse.

**Effort:** L
**Priority:** P4

### Multi-agent tab isolation

**What:** Two Claude sessions connect to the same browser, each operating on different tabs. No cross-contamination.

**Why:** Enables parallel /qa + /design-review on different tabs in the same browser.

**Context:** Requires tab ownership model for concurrent headed connections. Playwright may not cleanly support two persistent contexts. Needs investigation.

**Effort:** L (human: ~2 weeks / CC: ~2 hours)
**Priority:** P3
**Depends on:** Headed mode (shipped)

### Sidebar direct API calls (eliminate claude -p startup tax)

**What:** Each sidebar message spawns a fresh `claude -p` process (~2-3s cold start overhead). For "click @e24" that's absurd. Direct Anthropic API calls would be sub-second.

**Why:** The `claude -p` startup cost is: process spawn (~100ms) + CLI init (~500ms-1s) + API connection (~200ms) + first token. Model routing (Sonnet for actions) helps but doesn't fix the CLI overhead.

**Context:** `server.ts:spawnClaude()` builds args and writes to queue file. `sidebar-agent.ts:askClaude()` spawns `claude -p`. Replace with direct `fetch('https://api.anthropic.com/...')` with tool use. Requires `ANTHROPIC_API_KEY` accessible to the browse server.

**Effort:** M (human: ~1 week / CC: ~30min)
**Priority:** P2
**Depends on:** None

### Chrome Web Store publishing

**What:** Publish the goldband browse Chrome extension to Chrome Web Store for easier install.

**Why:** Currently sideloaded via chrome://extensions. Web Store makes install one-click.

**Effort:** S
**Priority:** P4
**Depends on:** Chrome extension proving value via sideloading

### Linux cookie decryption — PARTIALLY SHIPPED

~~**What:** GNOME Keyring / kwallet / DPAPI support for non-macOS cookie import.~~

Linux cookie import shipped in v0.11.11.0 (Wave 3). Supports Chrome, Chromium, Brave, Edge on Linux with GNOME Keyring (libsecret) and "peanuts" fallback. Windows DPAPI support remains deferred.

**Remaining:** Windows cookie decryption (DPAPI). Needs complete rewrite — PR #64 was 1346 lines and stale.

**Effort:** L (Windows only)
**Priority:** P4
**Completed (Linux):** v0.11.11.0 (2026-03-23)

## Release

### GitLab support for `$goldband release land`

**What:** Add GitLab MR merge + CI polling support to the release workflow. The current implementation uses GitHub-specific `gh` operations and needs an explicit `glab` adapter.

**Why:** GitLab users need the same merge, deploy, and verification outcome without reviving a separate shipping workflow.

**Effort:** L
**Priority:** P2
**Depends on:** None

## Review

### Inline PR annotations

**What:** Review and release actions post inline review comments at specific file:line locations using `gh api` to create pull request review comments.

**Why:** Line-level annotations are more actionable than top-level comments. The PR thread becomes a line-by-line conversation between Greptile, Claude, and human reviewers.

**Context:** GitHub supports inline review comments via `gh api repos/$REPO/pulls/$PR/reviews`. Pairs naturally with Phase 3.6 visual annotations.

**Effort:** S
**Priority:** P2
**Depends on:** None

### Greptile training feedback export

**What:** Aggregate greptile-history.md into machine-readable JSON summary of false positive patterns, exportable to the Greptile team for model improvement.

**Why:** Closes the feedback loop — Greptile can use FP data to stop making the same mistakes on your codebase.

**Context:** Was a P3 Future Idea. Upgraded to P2 now that greptile-history.md data infrastructure exists. The signal data is already being collected; this just makes it exportable. ~40 lines.

**Effort:** S
**Priority:** P2
**Depends on:** Enough FP data accumulated (10+ entries)

### Visual review with annotated screenshots

**What:** /review Step 4.5: browse PR's preview deploy, annotated screenshots of changed pages, compare against production, check responsive layouts, verify accessibility tree.

**Why:** Visual diff catches layout regressions that code review misses.

**Context:** Part of Phase 3.6. Needs S3 upload for image hosting.

**Effort:** M
**Priority:** P2
**Depends on:** /setup-goldband-upload

## QA

### QA trend tracking

**What:** Compare baseline.json over time, detect regressions across QA runs.

**Why:** Spot quality trends — is the app getting better or worse?

**Context:** QA already writes structured reports. This adds cross-run comparison.

**Effort:** S
**Priority:** P2

### CI/CD QA integration

**What:** `/qa` as GitHub Action step, fail PR if health score drops.

**Why:** Automated quality gate in CI. Catch regressions before merge.

**Effort:** M
**Priority:** P2

### Smart default QA tier

**What:** After a few runs, check index.md for user's usual tier pick, skip the AskUserQuestion.

**Why:** Reduces friction for repeat users.

**Effort:** S
**Priority:** P2

### Accessibility audit mode

**What:** `--a11y` flag for focused accessibility testing.

**Why:** Dedicated accessibility testing beyond the general QA checklist.

**Effort:** S
**Priority:** P3

### CI/CD generation for non-GitHub providers

**What:** Extend CI/CD bootstrap to generate GitLab CI (`.gitlab-ci.yml`), CircleCI (`.circleci/config.yml`), and Bitrise pipelines.

**Why:** Not all projects use GitHub Actions. Universal CI/CD bootstrap would make test bootstrap work for everyone.

**Context:** v1 ships with GitHub Actions only. Detection logic already checks for `.gitlab-ci.yml`, `.circleci/`, `bitrise.yml` and skips with an informational note. Each provider needs ~20 lines of template text in `generateTestBootstrap()`.

**Effort:** M
**Priority:** P3
**Depends on:** Test bootstrap (shipped)

### Auto-upgrade weak tests (★) to strong tests (★★★)

**What:** When Step 7 coverage audit identifies existing ★-rated tests (smoke/trivial assertions), generate improved versions testing edge cases and error paths.

**Why:** Many codebases have tests that technically exist but don't catch real bugs — `expect(component).toBeDefined()` isn't testing behavior. Upgrading these closes the gap between "has tests" and "has good tests."

**Context:** Requires the quality scoring rubric from the test coverage audit. Modifying existing test files is riskier than creating new ones — needs careful diffing to ensure the upgraded test still passes. Consider creating a companion test file rather than modifying the original.

**Effort:** M
**Priority:** P3
**Depends on:** Test quality scoring (shipped)

## Retro

### Deployment health tracking (retro + browse)

**What:** Screenshot production state, check perf metrics (page load times), count console errors across key pages, track trends over retro window.

**Why:** Retro should include production health alongside code metrics.

**Context:** Requires browse integration. Screenshots + metrics fed into retro output.

**Effort:** L
**Priority:** P3
**Depends on:** Browse sessions

## Infrastructure

### /setup-goldband-upload skill (S3 bucket)

**What:** Configure S3 bucket for image hosting. One-time setup for visual PR annotations.

**Why:** Prerequisite for visual PR annotations in review and release actions.

**Effort:** M
**Priority:** P2

### goldband-upload helper

**What:** `browse/bin/goldband-upload` — upload file to S3, return public URL.

**Why:** Shared utility for all skills that need to embed images in PRs.

**Effort:** S
**Priority:** P2
**Depends on:** /setup-goldband-upload

### WebM to GIF conversion

**What:** ffmpeg-based WebM → GIF conversion for video evidence in PRs.

**Why:** GitHub PR bodies render GIFs but not WebM. Needed for video recording evidence.

**Effort:** S
**Priority:** P3
**Depends on:** Video recording



### Extend worktree isolation to Claude E2E tests

**What:** Add `useWorktree?: boolean` option to `runSkillTest()` so any Claude E2E test can opt into worktree mode for full repo context instead of tmpdir fixtures.

**Why:** Some Claude E2E tests (CSO audit, review-sql-injection) create minimal fake repos but would produce more realistic results with full repo context. The infrastructure exists (`describeWithWorktree()` in e2e-helpers.ts) — this extends it to the session-runner level.

**Context:** WorktreeManager shipped in v0.11.12.0. Currently only Gemini/Codex tests use worktrees. Claude tests use planted-bug fixture repos which are correct for their purpose, but new tests that want real repo context can use `describeWithWorktree()` today. This TODO is about making it even easier via a flag on `runSkillTest()`.

**Effort:** M (human: ~2 days / CC: ~20 min)
**Priority:** P3
**Depends on:** Worktree isolation (shipped v0.11.12.0)

### Eval web dashboard

**What:** `bun run eval:dashboard` serves local HTML with charts: cost trending, detection rate, pass/fail history.

**Why:** Visual charts better for spotting trends than CLI tools.

**Context:** Reads `~/.goldband-dev/evals/*.json`. ~200 lines HTML + chart.js via Bun HTTP server.

**Effort:** M
**Priority:** P3
**Depends on:** Eval persistence (shipped in v0.3.6)

### CI/CD QA quality gate

**What:** Run `/qa` as a GitHub Action step, fail PR if health score drops below threshold.

**Why:** Automated quality gate catches regressions before merge. Currently QA is manual — CI integration makes it part of the standard workflow.

**Context:** Requires headless browse binary available in CI. The `/qa` skill already produces `baseline.json` with health scores — CI step would compare against the main branch baseline and fail if score drops. Would need `ANTHROPIC_API_KEY` in CI secrets since `/qa` uses Claude.

**Effort:** M
**Priority:** P2
**Depends on:** None

### Cross-platform URL open helper

**What:** `goldband-open-url` helper script — detect platform, use `open` (macOS) or `xdg-open` (Linux).

**Why:** The first-time Completeness Principle intro uses macOS `open` to launch the essay. If goldband ever supports Linux, this silently fails.

**Effort:** S (human: ~30 min / CC: ~2 min)
**Priority:** P4
**Depends on:** Nothing

### CDP-based DOM mutation detection for ref staleness

**What:** Use Chrome DevTools Protocol `DOM.documentUpdated` / MutationObserver events to proactively invalidate stale refs when the DOM changes, without requiring an explicit `snapshot` call.

**Why:** Current ref staleness detection (async count() check) only catches stale refs at action time. CDP mutation detection would proactively warn when refs become stale, preventing the 5-second timeout entirely for SPA re-renders.

**Context:** Parts 1+2 of ref staleness fix (RefEntry metadata + eager validation via count()) are shipped. This is Part 3 — the most ambitious piece. Requires CDP session alongside Playwright, MutationObserver bridge, and careful performance tuning to avoid overhead on every DOM change.

**Effort:** L
**Priority:** P3
**Depends on:** Ref staleness Parts 1+2 (shipped)

## Office Hours / Design

### /yc-prep skill

**What:** Skill that helps founders prepare their YC application after /office-hours identifies strong signal. Pulls from the design doc, structures answers to YC app questions, runs a mock interview.

**Why:** Closes the loop. /office-hours identifies the founder, /yc-prep helps them apply well. The design doc already contains most of the raw material for a YC application.

**Effort:** M (human: ~2 weeks / CC: ~2 hours)
**Priority:** P2
**Depends on:** office-hours founder discovery engine shipping first

## Design Review

### Design outside voices in /plan-eng-review

**What:** Extend the parallel dual-voice pattern (Codex + Claude subagent) to /plan-eng-review's architecture review section.

**Why:** The design beachhead (v0.11.3.0) proves cross-model consensus works for subjective reviews. Architecture reviews have similar subjectivity in tradeoff decisions.

**Context:** Depends on learnings from the design beachhead. If the litmus scorecard format proves useful, adapt it for architecture dimensions (coupling, scaling, reversibility).

**Effort:** S
**Priority:** P3
**Depends on:** Design outside voices shipped (v0.11.3.0)

### Outside voices in /qa visual regression detection

**What:** Add Codex design voice to /qa for detecting visual regressions during bug-fix verification.

**Why:** When fixing bugs, the fix can introduce visual regressions that code-level checks miss. Codex could flag "the fix broke the responsive layout" during re-test.

**Context:** Depends on /qa having design awareness. Currently /qa focuses on functional testing.

**Effort:** M
**Priority:** P3
**Depends on:** Design outside voices shipped (v0.11.3.0)

 ## Ship Confidence Dashboard

### Smart review relevance detection — PARTIALLY SHIPPED

~~**What:** Auto-detect which of the 4 reviews are relevant based on branch changes (skip Design Review if no CSS/view changes, skip Code Review if plan-only).~~

`bin/goldband-diff-scope` shipped — categorizes diff into SCOPE_FRONTEND, SCOPE_BACKEND, SCOPE_PROMPTS, SCOPE_TESTS, SCOPE_DOCS, SCOPE_CONFIG. Used by design-review-lite to skip when no frontend files changed. Dashboard integration for conditional row display is a follow-up.

**Remaining:** Dashboard conditional row display (hide "Design Review: NOT YET RUN" when SCOPE_FRONTEND=false). Extend to Eng Review (skip for docs-only) and CEO Review (skip for config-only).

**Effort:** S
**Priority:** P3
**Depends on:** goldband-diff-scope (shipped)


 ## Completeness

### Completeness metrics dashboard

**What:** Track how often Claude chooses the complete option vs shortcut across goldband sessions. Aggregate into a dashboard showing completeness trend over time.

**Why:** Without measurement, we can't know if the Completeness Principle is working. Could surface patterns (e.g., certain skills still bias toward shortcuts).

**Context:** Would require logging choices (e.g., append to a JSONL file when AskUserQuestion resolves), parsing them, and displaying trends. Similar pattern to eval persistence.

**Effort:** M (human) / S (CC)
**Priority:** P3
**Depends on:** Completeness Principle shipped (v0.6.1)

 ## Context Intelligence

 ### Session timeline

**What:** Append one-line JSONL entry to `~/.goldband/projects/$SLUG/timeline.jsonl` after every skill run (timestamp, skill, branch, outcome). `/retro` renders the timeline.

**Why:** Makes AI-assisted work history visible. `/retro` can show "this week: 3 review runs, 2 release runs, 1 investigation." Provides the observability layer for the session intelligence architecture.

**Effort:** S (human: ~1h / CC: ~5 min)
**Priority:** P1
**Depends on:** None
**Key files:** workflow evidence runtime and `retro/weekly` contract

 ### /checkpoint skill

**What:** Manual skill to snapshot current working state: what's being done and why, files being edited, decisions made (and rationale), what's done vs. remaining, critical types/signatures. Saved to `~/.goldband/projects/$SLUG/checkpoints/<timestamp>.md`.

**Why:** Useful before stepping away from a long session, before known-complex operations that might trigger compaction, for handing off context to a different agent/workspace, or coming back to a project after days away.

**Effort:** M (human: ~1 week / CC: ~30 min)
**Priority:** P2
**Depends on:** Runtime-owned context artifact format
**Key files:** `goldband.manifest.json`, context runtime, and contract tests

### Session Intelligence Layer design doc

**What:** Write `docs/designs/SESSION_INTELLIGENCE.md` describing the architectural vision: goldband as the persistent brain that survives Claude's ephemeral context. Every skill writes to `~/.goldband/projects/$SLUG/`, preamble re-reads, `/retro` rolls up.

**Why:** Connects context recovery, health, checkpoint, and timeline features into a coherent architecture. Nobody else in the ecosystem is building this.

**Effort:** S (human: ~2h / CC: ~15 min)
**Priority:** P1
**Depends on:** None

## Health

### /health — Project Health Dashboard

**What:** Skill that runs type-check, lint, test suite, and dead code scan, then reports a composite 0-10 health score with breakdown by category. Tracks over time in `~/.goldband/health/<project-slug>/` for trend detection. Optionally integrates CodeScene MCP for deeper complexity/cohesion/coupling analysis.

**Why:** No quick way to get "state of the codebase" before starting work. CodeScene peer-reviewed research shows AI-generated code increases static analysis warnings by 30%, code complexity by 41%, and change failure rates by 30%. Users need guardrails. Like `/qa` but for code quality rather than browser behavior.

**Context:** Reads CLAUDE.md for project-specific commands (platform-agnostic principle). Runs checks in parallel. `/retro` can pull from health history for trend sparklines.

**Effort:** M (human: ~1 week / CC: ~30 min)
**Priority:** P1
**Depends on:** None
**Key files:** `goldband.manifest.json`, health runtime, and contract tests

### Health as a release gate

**What:** If health score exists and drops below a configurable threshold, `$goldband release land` warns before creating the PR: "Health dropped from 8/10 to 5/10 this branch — 3 new lint warnings, 1 test failure. Continue?"

**Why:** Quality gate that prevents shipping degraded code. Configurable threshold so it's not blocking for teams that don't use `/health`.

**Effort:** S (human: ~1h / CC: ~5 min)
**Priority:** P2
**Depends on:** /health skill

## Swarm

### Swarm primitive — reusable multi-agent dispatch

**What:** Extract bounded parallel dispatch into a runtime-owned helper after a second typed consumer proves the shared contract. Wire it into release readiness for parallel checks (type-check + lint + test in parallel sub-agents). Make it available to QA, investigation, and health actions.

**Why:** Review Army proved parallel sub-agents work brilliantly (5 agents = 835K tokens of working memory vs. 167K for one). The pattern is locked inside `review-army.ts`. Other skills need it too. Claude Code Agent Teams (official, Feb 2026) validates the team-lead-delegates-to-specialists pattern. Gartner: multi-agent inquiries surged 1,445% in one year.

**Context:** Start with the specific release-readiness use case. Extract shared parts only after 2+ consumers reveal what config parameters are actually needed. Avoid premature abstraction. Can leverage existing WorktreeManager for isolation.

**Effort:** L (human: ~2 weeks / CC: ~2 hours)
**Priority:** P2
**Depends on:** None
**Key files:** typed workflow runtime, host adapter, and `lib/worktree.ts`

## Refactoring

### /refactor-prep — Pre-Refactor Token Hygiene

**What:** Skill that detects project language/framework, runs appropriate dead code detection (knip/ts-prune for TS/JS, vulture/autoflake for Python, staticcheck/deadcode for Go, cargo udeps for Rust), strips dead imports/exports/props/console.logs, and commits cleanup separately.

**Why:** Dirty codebases accelerate context compaction. Dead imports, unused exports, and orphaned code eat tokens that contribute nothing but everything to triggering compaction mid-refactor. Cleaning first buys back 20%+ of context budget. Reports lines removed and estimated token savings.

**Effort:** M (human: ~1 week / CC: ~30 min)
**Priority:** P2
**Depends on:** None
**Key files:** `goldband.manifest.json`, typed runtime, and contract tests

## Factory Droid

### Browse MCP server for Factory Droid

**What:** Expose goldband's browse binary and key workflows as an MCP server that Factory Droid connects to natively. Factory users would run /mcp, add the goldband server, and get browse, QA, and review capabilities as Factory tools.

**Why:** Factory already supports 40+ MCP servers in its registry. Getting goldband's browse binary listed there is a distribution play. Nobody else has a real compiled browser binary as an MCP tool. This is the thing that makes goldband uniquely valuable on Factory Droid.

**Context:** Option A (--host factory compatibility shim) ships first in v0.13.4.0. Option B is the follow-up that provides deeper integration. The browse binary is already a stateless CLI, so wrapping it as an MCP server is straightforward (stdin/stdout JSON-RPC). Each browse command becomes an MCP tool.

**Effort:** L (human: ~1 week / CC: ~5 hours)
**Priority:** P1
**Depends on:** --host factory (Option A, shipping in v0.13.4.0)

 ### Custom Droid definitions alongside skills

**What:** Factory has "custom droids" (subagents with tool restrictions, model selection, autonomy levels). Could ship `goldband-qa.md` droid configs alongside skills that restrict tools to read-only + execute for safety.

**Why:** Deeper Factory integration. Droid configs give Factory users tighter control over what goldband skills can do.

**Effort:** M
**Priority:** P3
**Depends on:** --host factory

## Goldband Loop Browser

### Anti-bot stealth: Playwright CDP patches (rebrowser-style)

**What:** Write a postinstall script that patches Playwright's CDP layer to suppress `Runtime.enable` and use `addBinding` for context ID discovery, same approach as rebrowser-patches. Eliminates the `navigator.webdriver`, `cdc_` markers, and other CDP artifacts that sites like Google use to detect automation.

**Why:** Our current stealth narrows to `navigator.webdriver` masking + ChromeDriver `cdc_` runtime cleanup + Permissions API patch (v1.28.0.0 narrowed it from also faking plugins/languages, since modern fingerprinters punish inconsistent fakes more than they punish admitted defaults). That's enough for most sites but Google still triggers captchas, because the real detection is at the CDP protocol level. rebrowser-patches proved the approach works but their patches target Playwright 1.52.0 and don't apply to our 1.58.2. We need our own patcher using string matching instead of line-number diffs. 6 files, ~200 lines of patches total.

**Context:** Full analysis of rebrowser-patches source: patches 6 files in `playwright-core/lib/server/` (crConnection.js, crDevTools.js, crPage.js, crServiceWorker.js, frames.js, page.js). Key technique: suppress `Runtime.enable` (the main CDP detection vector), use `Runtime.addBinding` + `CustomEvent` trick to discover execution context IDs without it. Our extension communicates via Chrome extension APIs, not CDP Runtime, so it should be unaffected. Write E2E tests that verify: (1) extension still loads and connects, (2) Google.com loads without captcha, (3) sidebar chat still works.

**Effort:** L (human: ~2 weeks / CC: ~3 hours)
**Priority:** P1
**Depends on:** None

### Chromium fork (long-term alternative to CDP patches)

**What:** Maintain a Chromium fork where anti-bot stealth, Goldband Loop Browser branding, and native sidebar support live in the source code, not as runtime monkey-patches.

**Why:** The CDP patches are brittle. They break on every Playwright upgrade and target compiled JS with fragile string matching. A proper fork means: (1) stealth is permanent, not patched, (2) branding is native (no plist hacking at launch), (3) native sidebar replaces the extension (Phase 4 of V0 roadmap), (4) custom protocols (goldband://) for internal pages. Companies like Brave, Arc, and Vivaldi maintain Chromium forks with small teams. With CC, the rebase-on-upstream maintenance could be largely automated.

**Context:** Trigger criteria from V0 design doc: fork when extension side panel becomes the bottleneck, when anti-bot patches need to live deeper than CDP, or when native UI integration (sidebar, status bar) can't be done via extension. The Chromium build takes ~4 hours on a 32-core machine and produces ~50GB of build artifacts. CI would need dedicated build infra. See `docs/designs/GOLDBAND_BROWSER_V0.md` Phase 5 for full analysis.

**Effort:** XL (human: ~1 quarter / CC: ~2-3 weeks of focused work)
**Priority:** P2
**Depends on:** CDP patches proving the value of anti-bot stealth first
