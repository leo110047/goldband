# goldband x OpenClaw Integration

goldband integrates with OpenClaw as a methodology source, not a ported
codebase. OpenClaw's ACP runtime spawns Claude Code sessions; goldband supplies
planning discipline and methodology as prompt text, with no daemon or protocol
layer.

## Architecture

```
  OpenClaw                               goldband repo
  ─────────────────────                    ──────────────
  Orchestrator: messaging,                 Source of truth for
  calendar, memory, EA                     methodology + planning
       │                                        │
       ├── Native skills (conversational)       ├── Tracks native skills
       │   office-hours, ceo-review,            │   under openclaw/skills
       │   investigate, retro                   │
       │                                        ├── Generates goldband-lite
       ├── sessions_spawn(runtime: "acp")       │   (planning discipline)
       │       │                                │
       │       └── Claude Code                  ├── Generates goldband-full
       │           └── goldband installed at      │   (complete pipeline)
       │               ~/.claude/skills/goldband  │
       │                                        └── docs/OPENCLAW.md (this file)
       └── Dispatch routing (AGENTS.md)
```

## Dispatch Routing

OpenClaw decides at spawn time which tier of goldband support to use:

| Tier | When | Prompt prefix |
|------|------|---------------|
| **Simple** | One-file edits, typos, config changes | No goldband context injected |
| **Medium** | Multi-file features, refactors | goldband-lite CLAUDE.md appended |
| **Heavy** | Specific goldband capability needed | "Load goldband. Run $goldband <capability> <action>" |
| **Full** | Complete features, objectives, projects | goldband-full pipeline appended |
| **Plan** | "Help me plan a Claude Code project" | goldband-plan pipeline appended |

### Decision heuristic

- Can it be done in <10 lines of code? -> **Simple**
- Does it touch multiple files but the approach is obvious? -> **Medium**
- Does the user name a specific Goldband capability? -> **Heavy**
- Is it a feature, project, or objective (not a task)? -> **Full**
- Does the user want to PLAN something for Claude Code without implementing yet? -> **Plan**

### Dispatch routing guide (for AGENTS.md)

The complete ready-to-paste section lives in `openclaw/agents-goldband-section.md`.
Copy it into your OpenClaw AGENTS.md.

Key behavioral rules (these go ABOVE the dispatch tiers):

1. **Always spawn, never redirect.** When the user asks to use ANY goldband skill,
   ALWAYS spawn a Claude Code session. Never tell the user to open Claude Code.
2. **Resolve the repo.** If the user names a repo, set the working directory. If
   unknown, ask which repo.
3. **Planning runs end-to-end.** Spawn `$goldband plan create`, let its review stage finish, report back
   in chat. User should never have to leave Telegram.

### CLAUDE.md collision handling

When spawning Claude Code in a repo that already has a CLAUDE.md, APPEND
goldband-lite/full as a new section. Do not replace the repo's existing instructions.

## Tracked OpenClaw assets

All OpenClaw-specific artifacts are reviewed source files under `openclaw/`.
They are not generated from Goldband workflow prompts.

### goldband-lite (Medium tier)
`openclaw/goldband-lite-CLAUDE.md` — planning discipline:
1. Read every file before modifying
2. Write a 5-line plan: what, why, which files, test case, risk
3. Resolve ambiguity using decision principles
4. Self-review before reporting done
5. Completion report: what shipped, decisions made, anything uncertain

### goldband-full (Full tier)
`openclaw/goldband-full-CLAUDE.md` — chains existing goldband skills:
1. Read CLAUDE.md and understand the project
2. Run `$goldband plan create` and include its engineering and design review stages
3. Implement the approved plan
4. Use the user-approved repository release process to create and land the PR
5. Report back with PR URL and decisions

### goldband-plan (Plan tier)
`openclaw/goldband-plan-CLAUDE.md` — full review gauntlet, no implementation:
1. Run `$goldband plan create` to produce a design doc
2. Complete the plan's engineering, design, DX, and adversarial review stages
3. Save the reviewed plan to `plans/<project-slug>-plan-<date>.md`
4. Report back: plan path, summary, key decisions, recommended next step

The orchestrator persists the plan link in the memory store configured in
AGENTS.md. Building starts a Full session that references the saved plan.

### Native methodology skills
Published to ClawHub. Install with `clawhub install`:
- `goldband-openclaw-office-hours` — Product interrogation (6 forcing questions)
- `goldband-openclaw-ceo-review` — Compact strategic challenge with an on-demand deep rubric
- `goldband-openclaw-investigate` — Operational debugging (5-phase methodology)
- `goldband-openclaw-retro` — Operational retrospective (weekly review)

Source lives in `openclaw/skills/`. They adapt goldband methodology to
OpenClaw's conversational context and use no goldband runtime, telemetry, or
preamble.

## Installation

The OpenClaw agent installs goldband by:
1. Install goldband-lite CLAUDE.md into its coding session templates
2. Install the 4 native methodology skills
3. Add dispatch routing to AGENTS.md
4. Verify with a test spawn

For goldband developers, `./setup --host openclaw` points to this documentation
and the tracked assets.

## Out of Scope

- Dispatch daemon: ACP spawns sessions.
- Relay or security layer between OpenClaw and Claude Code.
- Bidirectional learnings bridge: OpenClaw's memory store owns knowledge.
- JSON schemas or protocol versioning.
- SOUL.md: OpenClaw owns its own.
- Porting coding skills: they stay native to Claude Code.
