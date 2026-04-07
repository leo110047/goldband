# workflow

> "I don't think I've typed like a line of code probably since December, basically, which is an extremely large change." — [Andrej Karpathy](https://fortune.com/2026/03/21/andrej-karpathy-openai-cofounder-ai-agents-coding-state-of-psychosis-openclaw/), No Priors podcast, March 2026

**workflow** turns Claude Code into a virtual engineering team — a CEO who rethinks the product, an eng manager who locks architecture, a designer who catches AI slop, a reviewer who finds production bugs, a QA lead who opens a real browser, a security officer who runs OWASP + STRIDE audits, and a release engineer who ships the PR. Twenty specialists and eight power tools, all slash commands, all Markdown, all free, MIT license.

**Who this is for:**
- **Founders and CEOs** — especially technical ones who still want to ship
- **First-time Claude Code users** — structured roles instead of a blank prompt
- **Tech leads and staff engineers** — rigorous review, QA, and release automation on every PR

## Quick start

1. Install workflow (30 seconds — see below)
2. Run `/goldband-office-hours` — describe what you're building
3. Run `/goldband-plan-ceo-review` on any feature idea
4. Run `/goldband-review` on any branch with changes
5. Run `/goldband-qa` on your staging URL
6. Stop there. You'll know if this is for you.

## Install — 30 seconds

**Requirements:** [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Git](https://git-scm.com/), [Bun](https://bun.sh/) v1.0+, [Node.js](https://nodejs.org/) (Windows only)

### Step 1: Install on your machine

Open Claude Code and paste this. Claude does the rest.

> Install workflow: run **`git clone https://github.com/garrytan/workflow.git ~/.claude/skills/workflow && cd ~/.claude/skills/workflow && ./setup`** then add a "workflow" section to CLAUDE.md that says to use the /goldband-browse skill from workflow for all web browsing, never use mcp\_\_claude-in-chrome\_\_\* tools, and lists the available skills: /goldband-office-hours, /goldband-plan-ceo-review, /goldband-plan-eng-review, /goldband-plan-design-review, /goldband-design-consultation, /goldband-review, /goldband-ship, /goldband-land-and-deploy, /goldband-canary, /goldband-benchmark, /goldband-browse, /goldband-qa, /goldband-qa-only, /goldband-design-review, /goldband-setup-browser-cookies, /goldband-setup-deploy, /goldband-retro, /goldband-investigate, /goldband-document-release, /goldband-codex, /goldband-cso, /goldband-autoplan, /goldband-careful, /goldband-freeze, /goldband-guard, /goldband-unfreeze. Then ask the user if they also want to add workflow to the current project so teammates get it.

### Step 2: Add to your repo so teammates get it (optional)

> Add workflow to this project: run **`cp -Rf ~/.claude/skills/workflow .claude/skills/workflow && rm -rf .claude/skills/workflow/.git && cd .claude/skills/workflow && ./setup`** then add a "workflow" section to this project's CLAUDE.md that says to use the /goldband-browse skill from workflow for all web browsing, never use mcp\_\_claude-in-chrome\_\_\* tools, lists the available skills: /goldband-office-hours, /goldband-plan-ceo-review, /goldband-plan-eng-review, /goldband-plan-design-review, /goldband-design-consultation, /goldband-review, /goldband-ship, /goldband-land-and-deploy, /goldband-canary, /goldband-benchmark, /goldband-browse, /goldband-qa, /goldband-qa-only, /goldband-design-review, /goldband-setup-browser-cookies, /goldband-setup-deploy, /goldband-retro, /goldband-investigate, /goldband-document-release, /goldband-codex, /goldband-cso, /goldband-careful, /goldband-freeze, /goldband-guard, /goldband-unfreeze, and tells Claude that if workflow skills aren't working, run `cd .claude/skills/workflow && ./setup` to build the binary and register skills.

Real files get committed to your repo (not a submodule), so `git clone` just works. Everything lives inside `.claude/`. Nothing touches your PATH or runs in the background.

### Codex, Gemini CLI, or Cursor

workflow works on any agent that supports the [SKILL.md standard](https://github.com/anthropics/claude-code). Skills live in `.agents/skills/` and are discovered automatically.

Install to one repo:

```bash
git clone https://github.com/garrytan/workflow.git .agents/skills/workflow
cd .agents/skills/workflow && ./setup --host codex
```

When setup runs from `.agents/skills/workflow`, it installs the generated Codex skills next to it in the same repo and does not write to `~/.codex/skills`.

Install once for your user account:

```bash
git clone https://github.com/garrytan/workflow.git ~/workflow
cd ~/workflow && ./setup --host codex
```

`setup --host codex` creates the runtime root at `~/.codex/skills/workflow` and
links the generated Codex skills at the top level. This avoids duplicate skill
discovery from the source repo checkout.

Or let setup auto-detect which agents you have installed:

```bash
git clone https://github.com/garrytan/workflow.git ~/workflow
cd ~/workflow && ./setup --host auto
```

For Codex-compatible hosts, setup now supports both repo-local installs from `.agents/skills/workflow` and user-global installs from `~/.codex/skills/workflow`. All 28 skills work across all supported agents. Hook-based safety skills (careful, freeze, guard) use inline safety advisory prose on non-Claude hosts.

## See it work

```
You:    I want to build a daily briefing app for my calendar.
You:    /goldband-office-hours
Claude: [asks about the pain — specific examples, not hypotheticals]

You:    Multiple Google calendars, events with stale info, wrong locations.
        Prep takes forever and the results aren't good enough...

Claude: I'm going to push back on the framing. You said "daily briefing
        app." But what you actually described is a personal chief of
        staff AI.
        [extracts 5 capabilities you didn't realize you were describing]
        [challenges 4 premises — you agree, disagree, or adjust]
        [generates 3 implementation approaches with effort estimates]
        RECOMMENDATION: Ship the narrowest wedge tomorrow, learn from
        real usage. The full vision is a 3-month project — start with
        the daily briefing that actually works.
        [writes design doc → feeds into downstream skills automatically]

You:    /goldband-plan-ceo-review
        [reads the design doc, challenges scope, runs 10-section review]

You:    /goldband-plan-eng-review
        [ASCII diagrams for data flow, state machines, error paths]
        [test matrix, failure modes, security concerns]

You:    Approve plan. Exit plan mode.
        [writes 2,400 lines across 11 files. ~8 minutes.]

You:    /goldband-review
        [AUTO-FIXED] 2 issues. [ASK] Race condition → you approve fix.

You:    /goldband-qa https://staging.myapp.com
        [opens real browser, clicks through flows, finds and fixes a bug]

You:    /goldband-ship
        Tests: 42 → 51 (+9 new). PR: github.com/you/app/pull/42
```

You said "daily briefing app." The agent said "you're building a chief of staff AI" — because it listened to your pain, not your feature request. Eight commands, end to end. That is not a copilot. That is a team.

## The sprint

workflow is a process, not a collection of tools. The skills run in the order a sprint runs:

**Think → Plan → Build → Review → Test → Ship → Reflect**

Each skill feeds into the next. `/goldband-office-hours` writes a design doc that `/goldband-plan-ceo-review` reads. `/goldband-plan-eng-review` writes a test plan that `/goldband-qa` picks up. `/goldband-review` catches bugs that `/goldband-ship` verifies are fixed. Nothing falls through the cracks because every step knows what came before it.

| Skill | Your specialist | What they do |
|-------|----------------|--------------|
| `/goldband-office-hours` | **YC Office Hours** | Start here. Six forcing questions that reframe your product before you write code. Pushes back on your framing, challenges premises, generates implementation alternatives. Design doc feeds into every downstream skill. |
| `/goldband-plan-ceo-review` | **CEO / Founder** | Rethink the problem. Find the 10-star product hiding inside the request. Four modes: Expansion, Selective Expansion, Hold Scope, Reduction. |
| `/goldband-plan-eng-review` | **Eng Manager** | Lock in architecture, data flow, diagrams, edge cases, and tests. Forces hidden assumptions into the open. |
| `/goldband-plan-design-review` | **Senior Designer** | Rates each design dimension 0-10, explains what a 10 looks like, then edits the plan to get there. AI Slop detection. Interactive — one AskUserQuestion per design choice. |
| `/goldband-design-consultation` | **Design Partner** | Build a complete design system from scratch. Researches the landscape, proposes creative risks, generates realistic product mockups. |
| `/goldband-review` | **Staff Engineer** | Find the bugs that pass CI but blow up in production. Auto-fixes the obvious ones. Flags completeness gaps. |
| `/goldband-investigate` | **Debugger** | Systematic root-cause debugging. Iron Law: no fixes without investigation. Traces data flow, tests hypotheses, stops after 3 failed fixes. |
| `/goldband-design-review` | **Designer Who Codes** | Same audit as /goldband-plan-design-review, then fixes what it finds. Atomic commits, before/after screenshots. |
| `/goldband-qa` | **QA Lead** | Test your app, find bugs, fix them with atomic commits, re-verify. Auto-generates regression tests for every fix. |
| `/goldband-qa-only` | **QA Reporter** | Same methodology as /goldband-qa but report only. Pure bug report without code changes. |
| `/goldband-cso` | **Chief Security Officer** | OWASP Top 10 + STRIDE threat model. Zero-noise: 17 false positive exclusions, 8/10+ confidence gate, independent finding verification. Each finding includes a concrete exploit scenario. |
| `/goldband-ship` | **Release Engineer** | Sync main, run tests, audit coverage, push, open PR. Bootstraps test frameworks if you don't have one. |
| `/goldband-land-and-deploy` | **Release Engineer** | Merge the PR, wait for CI and deploy, verify production health. One command from "approved" to "verified in production." |
| `/goldband-canary` | **SRE** | Post-deploy monitoring loop. Watches for console errors, performance regressions, and page failures. |
| `/goldband-benchmark` | **Performance Engineer** | Baseline page load times, Core Web Vitals, and resource sizes. Compare before/after on every PR. |
| `/goldband-document-release` | **Technical Writer** | Update all project docs to match what you just shipped. Catches stale READMEs automatically. |
| `/goldband-retro` | **Eng Manager** | Team-aware weekly retro. Per-person breakdowns, shipping streaks, test health trends, growth opportunities. `/goldband-retro global` runs across all your projects and AI tools (Claude Code, Codex, Gemini). |
| `/goldband-browse` | **QA Engineer** | Real Chromium browser, real clicks, real screenshots. ~100ms per command. |
| `/goldband-setup-browser-cookies` | **Session Manager** | Import cookies from your real browser (Chrome, Arc, Brave, Edge) into the headless session. Test authenticated pages. |
| `/goldband-autoplan` | **Review Pipeline** | One command, fully reviewed plan. Runs CEO → design → eng review automatically with encoded decision principles. Surfaces only taste decisions for your approval. |

### Power tools

| Skill | What it does |
|-------|-------------|
| `/goldband-codex` | **Second Opinion** — independent code review from OpenAI Codex CLI. Three modes: review (pass/fail gate), adversarial challenge, and open consultation. Cross-model analysis when both `/goldband-review` and `/goldband-codex` have run. |
| `/goldband-careful` | **Safety Guardrails** — warns before destructive commands (rm -rf, DROP TABLE, force-push). Say "be careful" to activate. Override any warning. |
| `/goldband-freeze` | **Edit Lock** — restrict file edits to one directory. Prevents accidental changes outside scope while debugging. |
| `/goldband-guard` | **Full Safety** — `/goldband-careful` + `/goldband-freeze` in one command. Maximum safety for prod work. |
| `/goldband-unfreeze` | **Unlock** — remove the `/goldband-freeze` boundary. |
| `/goldband-setup-deploy` | **Deploy Configurator** — one-time setup for `/goldband-land-and-deploy`. Detects your platform, production URL, and deploy commands. |
**[Deep dives with examples and philosophy for every skill →](docs/skills.md)**

## Parallel sprints

workflow works well with one sprint. It gets interesting with ten running at once.

[Conductor](https://conductor.build) runs multiple Claude Code sessions in parallel — each in its own isolated workspace. One session on `/goldband-office-hours`, another on `/goldband-review`, a third implementing a feature, a fourth running `/goldband-qa`. All at the same time. The sprint structure is what makes parallelism work — without a process, ten agents is ten sources of chaos. With a process, each agent knows exactly what to do and when to stop.

---

Free, MIT licensed, open source. No premium tier, no waitlist.

I open sourced how I build software. You can fork it and make it your own.

> **We're hiring.** Want to ship 10K+ LOC/day and help harden workflow?
> Come work at YC — [ycombinator.com/software](https://ycombinator.com/software)
> Extremely competitive salary and equity. San Francisco, Dogpatch District.

## Docs

| Doc | What it covers |
|-----|---------------|
| [Skill Deep Dives](docs/skills.md) | Philosophy, examples, and workflow for every skill (includes Greptile integration) |
| [Builder Ethos](ETHOS.md) | Builder philosophy: Boil the Lake, Search Before Building, three layers of knowledge |
| [Architecture](ARCHITECTURE.md) | Design decisions and system internals |
| [Browser Reference](BROWSER.md) | Full command reference for `/goldband-browse` |
| [Contributing](CONTRIBUTING.md) | Dev setup, testing, contributor mode, and dev mode |
| [Changelog](CHANGELOG.md) | What's new in every version |

## Local Analytics

workflow keeps local usage analytics in `~/.workflow/analytics/skill-usage.jsonl`.

- Data stays on your machine.
- No community/anonymous/device-ID onboarding is required.
- Run `workflow-analytics` to see your personal usage dashboard.
- `workflow-telemetry-sync` is currently local-only/no-op in this tree. The bundled Supabase schema is only relevant if you self-host the optional telemetry backend.

## Troubleshooting

**Skill not showing up?** `cd ~/.claude/skills/workflow && ./setup`

**`/goldband-browse` fails?** `cd ~/.claude/skills/workflow && bun install && bun run build`

**Stale install?** Re-run `./setup` from your workflow checkout.

**Codex says "Skipped loading skill(s) due to invalid SKILL.md"?** Your Codex skill descriptions are stale. Fix: rerun `./setup --host codex` from your workflow checkout (for example `~/workflow`, or `$HOME/.workflow/repos/workflow` if setup migrated an old direct Codex install) — or for repo-local installs: `cd "$(readlink -f .agents/skills/workflow)" && git pull && ./setup --host codex`

**Self-hosted telemetry DB still has the pre-rename version column?** Apply every migration in `supabase/migrations/`, including `002_telemetry_workflow_schema_compat.sql`. That compatibility migration renames already-deployed legacy version columns to `workflow_version` and rebuilds the dependent index/view definitions.

**Windows users:** workflow works on Windows 11 via Git Bash or WSL. Node.js is required in addition to Bun — Bun has a known bug with Playwright's pipe transport on Windows ([bun#4253](https://github.com/oven-sh/bun/issues/4253)). The browse server automatically falls back to Node.js. Make sure both `bun` and `node` are on your PATH.

**Claude says it can't see the skills?** Make sure your project's `CLAUDE.md` has a workflow section. Add this:

```
## workflow
Use /goldband-browse from workflow for all web browsing. Never use mcp__claude-in-chrome__* tools.
Available skills: /goldband-office-hours, /goldband-plan-ceo-review, /goldband-plan-eng-review, /goldband-plan-design-review,
/goldband-design-consultation, /goldband-review, /goldband-ship, /goldband-land-and-deploy, /goldband-canary, /goldband-benchmark, /goldband-browse,
/goldband-qa, /goldband-qa-only, /goldband-design-review, /goldband-setup-browser-cookies, /goldband-setup-deploy, /goldband-retro,
/goldband-investigate, /goldband-document-release, /goldband-codex, /goldband-cso, /goldband-autoplan, /goldband-careful, /goldband-freeze, /goldband-guard,
/goldband-unfreeze.
```

## License

MIT. Free forever. Go build something.
