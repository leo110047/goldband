# TODOS

Completed work is removed from this backlog; Git history keeps it.

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

## Personalization follow-up

Any future personalization must be an explicit, inspectable runtime or user-config feature. Do not inject psychographic adaptation, blind-spot coaching, or pacing policy into every workflow prompt.

## Browse

## Browse

### Video recording

**What:** Record browser interactions as video (start/stop controls).

**Why:** Video evidence in QA reports and PR bodies. Currently deferred because `recreateContext()` destroys page state.

**Context:** Needs sessions for clean context lifecycle. Playwright supports video recording per context. Also needs WebM → GIF conversion for PR embedding.

**Effort:** M
**Priority:** P3
**Depends on:** Sessions

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

### Multi-agent tab isolation

**What:** Two Claude sessions connect to the same browser, each operating on different tabs. No cross-contamination.

**Why:** Enables parallel /qa + /design-review on different tabs in the same browser.

**Context:** Requires tab ownership model for concurrent headed connections. Playwright may not cleanly support two persistent contexts. Needs investigation.

**Effort:** L (human: ~2 weeks / CC: ~2 hours)
**Priority:** P3
**Depends on:** Headed mode (shipped)

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

### Deployment health tracking (retro + browser)

**What:** Screenshot production state, check perf metrics (page load times), count console errors across key pages, track trends over retro window.

**Why:** Retro should include production health alongside code metrics.

**Context:** Requires browser access from the host. Screenshots + metrics fed into retro output.

**Effort:** L
**Priority:** P3
**Depends on:** Browse sessions

## Infrastructure

### /setup-goldband-upload skill (S3 bucket)

**What:** Configure S3 bucket for image hosting. One-time setup for visual PR annotations.

**Why:** Prerequisite for visual PR annotations in review and release actions.

**Effort:** M
**Priority:** P2

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

**Context:** Requires a headless browser (for example Playwright) available in CI. The `/qa` skill already produces `baseline.json` with health scores — CI step would compare against the main branch baseline and fail if score drops. Would need `ANTHROPIC_API_KEY` in CI secrets since `/qa` uses Claude.

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

## Goldband Loop Browser
