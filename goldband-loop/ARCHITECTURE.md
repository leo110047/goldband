# Architecture

This document explains **why** goldband is built the way it is. For setup and commands, see CLAUDE.md. For contributing, see CONTRIBUTING.md.

## Semantic review runtime

`review/code` is defined in [workflows/README.md](workflows/README.md).

## Browser work

Goldband does not ship its own browser. QA and other browser work use the
browser capability of the active host: Claude in Chrome or a configured
Playwright MCP server on Claude Code, and the host browser or Playwright MCP on
Codex. `manuals/browser.md` holds the shared guidance, and `qa/app` loads it.
See the root `mcp/README.md` for the optional Playwright MCP template and its
isolation defaults.

`make-pdf` is the only component that drives Chromium directly. It launches a
dedicated headless Chromium through Playwright for each render
(`make-pdf/src/pdfRenderer.ts`) and closes it afterwards.

## Why Bun

`design` and `make-pdf` ship as `bun build --compile` binaries: a single
executable with no `node_modules` or PATH setup at runtime, which matters
because goldband installs into host skill directories where users do not expect
to manage a Node.js project. Workflow runtimes run TypeScript directly with
`bun run`, so there is no compilation step during development.

## Workflow prompt architecture

`goldband.manifest.json` owns every workflow's goal, relevant context, hard
boundaries, and verification contract. The root `SKILL.md.tmpl` is only a small
capability router. `scripts/generate-goldband-surfaces.mjs` renders:

```
goldband.manifest.json
  ├── goldband-loop/SKILL.md
  ├── goldband-loop/generated/capability-actions.json
  ├── goldband-loop/generated/workflow-contracts/<capability>/<action>.workflow.md
  ├── goldband-loop/workflows/capability-registry.generated.ts
  └── docs/generated/capabilities.md
```

The installer copies or links the same root router and thin contracts for each
supported host. It does not generate host-specific workflow prompts. The model
owns decomposition, tool selection, and adaptation; runtime code owns
deterministic state, validation, safety gates, and evidence.

Per-workflow `SKILL.md`/`SKILL.md.tmpl`, universal preamble injection, model
overlays, and resolver-driven prompt assembly are retired. Contract generation
fails when prohibited boilerplate appears or when size limits are exceeded.
`scripts/test-workflow-contracts.mjs` also rejects their reintroduction.

## E2E test infrastructure

### Session runner (`test/helpers/session-runner.ts`)

E2E tests spawn `claude -p` as a completely independent subprocess — not via the Agent SDK, which can't nest inside Claude Code sessions. The runner:

1. Writes the prompt to a temp file (avoids shell escaping issues)
2. Spawns `sh -c 'cat prompt | claude -p --output-format stream-json --verbose'`
3. Streams NDJSON from stdout for real-time progress
4. Races against a configurable timeout
5. Parses the full NDJSON transcript into structured results

The `parseNDJSON()` function is pure — no I/O, no side effects — making it independently testable.

### Observability data flow

```
  skill-e2e-*.test.ts
        │
        │ generates runId, passes testName + runId to each call
        │
  ┌─────┼──────────────────────────────┐
  │     │                              │
  │  runSkillTest()              evalCollector
  │  (session-runner.ts)         (eval-store.ts)
  │     │                              │
  │  per tool call:              per addTest():
  │  ┌──┼──────────┐              savePartial()
  │  │  │          │                   │
  │  ▼  ▼          ▼                   ▼
  │ [HB] [PL]    [NJ]          _partial-e2e.json
  │  │    │        │             (atomic overwrite)
  │  │    │        │
  │  ▼    ▼        ▼
  │ e2e-  prog-  {name}
  │ live  ress   .ndjson
  │ .json .log
  │
  │  on failure:
  │  {name}-failure.json
  │
  │  Heartbeat: ~/.goldband-dev/
  │  Run dir and partial: project dir
  │  (e2e-runs/{runId}/, evals/)
  │
  │         eval-watch.ts
  │              │
  │        ┌─────┴─────┐
  │     read HB     read partial
  │        └─────┬─────┘
  │              ▼
  │        render dashboard
  │        (stale >10min? warn)
```

**Split ownership:** session-runner owns the heartbeat (current test state), eval-store owns partial results (completed test state). The watcher reads both. Neither component knows about the other — they share data only through the filesystem.

**Non-fatal everything:** All observability I/O is wrapped in try/catch. A write failure never causes a test to fail. The tests themselves are the source of truth; observability is best-effort.

**Machine-readable diagnostics:** Each test result includes `exit_reason` (success, timeout, error_max_turns, error_api, exit_code_N), `timeout_at_turn`, and `last_tool_call`.

### Eval persistence (`test/helpers/eval-store.ts`)

The `EvalCollector` writes to the eval directory from `getProjectEvalDir()`:
`~/.goldband/projects/$SLUG/evals/`, or `~/.goldband-dev/evals/` when slug
detection fails.

1. **Incremental:** `savePartial()` atomically writes `_partial-e2e.json` after each test, so results survive kills.
2. **Final:** `finalize()` writes `{version}-{branch}-{tier}-{timestamp}.json`. The partial file persists alongside it. Run listings and comparisons skip it; the eval budget cap counts it unless a final run in the same directory, of the same tier, at or after its timestamp, contains every test it recorded.

`eval:compare` diffs two eval runs; `eval:summary` aggregates all runs in the eval directory.

### Test tiers

| Tier | What | Cost | Speed |
|------|------|------|-------|
| 1 — Static validation | Contract, registry, and observability unit tests | Free | <5s |
| 2 — E2E via `claude -p` | Spawn real Claude session, run each skill, scan for errors | ~$3.85 | ~20min |
| 3 — LLM-as-judge | Sonnet scores docs on clarity/completeness/actionability | ~$0.15 | ~30s |

Tier 1 runs on every `bun test`. Tiers 2 and 3 call paid models and run only with `EVALS=1`.
