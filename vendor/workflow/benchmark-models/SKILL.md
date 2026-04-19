---
name: benchmark-models
preamble-tier: 1
version: 1.0.0
description: |
  MANUAL TRIGGER ONLY: invoke only when user types /benchmark-models.
  Cross-model benchmark for workflow skills. Runs the same prompt through Claude,
  GPT (via Codex CLI), and Gemini side-by-side — compares latency, tokens, cost,
  and optionally quality via LLM judge. Answers "which model is actually best
  for this skill?" with data instead of vibes. Separate from /benchmark, which
  measures web page performance. Use when: "benchmark models", "compare models",
  "which model is best for X", "cross-model comparison", "model shootout". (workflow)
voice-triggers:
  - "compare models"
  - "model shootout"
  - "which model is best"
triggers:
  - cross model benchmark
  - compare claude gpt gemini
  - benchmark skill across models
  - which model should I use
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---
<!-- AUTO-GENERATED from SKILL.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->

## Preamble (run first)

```bash
mkdir -p ~/.workflow
mkdir -p ~/.workflow/sessions
touch ~/.workflow/sessions/"$PPID"
_SESSIONS=$(find ~/.workflow/sessions -mmin -120 -type f 2>/dev/null | wc -l | tr -d ' ')
find ~/.workflow/sessions -mmin +120 -type f -delete 2>/dev/null || true
_CONTRIB=$(~/.claude/skills/workflow/bin/workflow-config get workflow_contributor 2>/dev/null || true)
_PROACTIVE=$(~/.claude/skills/workflow/bin/workflow-config get proactive 2>/dev/null || echo "true")
_EXPLAIN_LEVEL=$(~/.claude/skills/workflow/bin/workflow-config get explain_level 2>/dev/null || echo "default")
_QUESTION_TUNING=$(~/.claude/skills/workflow/bin/workflow-config get question_tuning 2>/dev/null || echo "false")
_WRITING_PENDING=$([ -f ~/.workflow/.writing-style-prompt-pending ] && echo "yes" || echo "no")
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "PROACTIVE: $_PROACTIVE"
echo "EXPLAIN_LEVEL: $_EXPLAIN_LEVEL"
echo "QUESTION_TUNING: $_QUESTION_TUNING"
echo "WRITING_STYLE_PENDING: $_WRITING_PENDING"
source <(~/.claude/skills/workflow/bin/workflow-repo-mode 2>/dev/null) || true
REPO_MODE=${REPO_MODE:-unknown}
echo "REPO_MODE: $REPO_MODE"
_LAKE_SEEN=$([ -f ~/.workflow/.completeness-intro-seen ] && echo "yes" || echo "no")
echo "LAKE_INTRO: $_LAKE_SEEN"
mkdir -p ~/.workflow/analytics
echo '{"skill":"benchmark-models","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","repo":"'$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "unknown")'"}'  >> ~/.workflow/analytics/skill-usage.jsonl 2>/dev/null || true
```

If `PROACTIVE` is `"false"`, do not proactively suggest workflow skills — only invoke
them when the user explicitly asks. The user opted out of proactive suggestions.

If `WRITING_STYLE_PENDING` is `yes`: You're on the first skill run after upgrading
to workflow v1. Ask the user once about the new default writing style. Use AskUserQuestion:

> v1 prompts = simpler. Technical terms get a one-sentence gloss on first use,
> questions are framed in outcome terms, sentences are shorter.
>
> Keep the new default, or prefer the older tighter prose?

Options:
- A) Keep the new default (recommended — good writing helps everyone)
- B) Restore V0 prose — set `explain_level: terse`

If A: leave `explain_level` unset (defaults to `default`).
If B: run `~/.claude/skills/workflow/bin/workflow-config set explain_level terse`.

Always run (regardless of choice):
```bash
rm -f ~/.workflow/.writing-style-prompt-pending
touch ~/.workflow/.writing-style-prompted
```

This only happens once. If `WRITING_STYLE_PENDING` is `no`, skip this entirely.

If `LAKE_INTRO` is `no`: Before continuing, introduce the Completeness Principle.
Tell the user: "workflow follows the **Boil the Lake** principle — always do the complete
thing when AI makes the marginal cost near-zero. Read more: https://garryslist.org/posts/boil-the-ocean"
Then offer to open the essay in their default browser:

```bash
open https://garryslist.org/posts/boil-the-ocean
touch ~/.workflow/.completeness-intro-seen
```

Only run `open` if the user says yes. Always run `touch` to mark as seen. This only happens once.

## Contributor Mode

If `_CONTRIB` is `true`: you are in **contributor mode**. At the end of each major workflow step, rate your workflow experience 0-10. If not a 10 and there's an actionable bug or improvement — file a field report.

**File only:** workflow tooling bugs where the input was reasonable but workflow failed. **Skip:** user app bugs, network errors, auth failures on user's site.

**To file:** write `~/.workflow/contributor-logs/{slug}.md`:
```
# {Title}
**What I tried:** {action} | **What happened:** {result} | **Rating:** {0-10}
## Repro
1. {step}
## What would make this a 10
{one sentence}
**Date:** {YYYY-MM-DD} | **Version:** {version} | **Skill:** /{skill}
```
Slug: lowercase hyphens, max 60 chars. Skip if exists. Max 3/session. File inline, don't stop.

## Completion Status Protocol

When completing a skill workflow, report status using one of:
- **DONE** — All steps completed successfully. Evidence provided for each claim.
- **DONE_WITH_CONCERNS** — Completed, but with issues the user should know about. List each concern.
- **BLOCKED** — Cannot proceed. State what is blocking and what was tried.
- **NEEDS_CONTEXT** — Missing information required to continue. State exactly what you need.

### Escalation

It is always OK to stop and say "this is too hard for me" or "I'm not confident in this result."

Bad work is worse than no work. You will not be penalized for escalating.
- If you have attempted a task 3 times without success, STOP and escalate.
- If you are uncertain about a security-sensitive change, STOP and escalate.
- If the scope of work exceeds what you can verify, STOP and escalate.

Escalation format:
```
STATUS: BLOCKED | NEEDS_CONTEXT
REASON: [1-2 sentences]
ATTEMPTED: [what you tried]
RECOMMENDATION: [what the user should do next]
```

## Plan Status Footer

When you are in plan mode and about to call ExitPlanMode:

1. Check if the plan file already has a `## WORKFLOW REVIEW REPORT` section.
2. If it DOES — skip (a review skill already wrote a richer report).
3. If it does NOT — run this command:

\`\`\`bash
~/.claude/skills/workflow/bin/workflow-review-read
\`\`\`

Then write a `## WORKFLOW REVIEW REPORT` section to the end of the plan file:

- If the output contains review entries (JSONL lines before `---CONFIG---`): format the
  standard report table with runs/status/findings per skill, same format as the review
  skills use.
- If the output is `NO_REVIEWS` or empty: write this placeholder table:

\`\`\`markdown
## WORKFLOW REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | \`/plan-ceo-review\` | Scope & strategy | 0 | — | — |
| Codex Review | \`/codex review\` | Independent 2nd opinion | 0 | — | — |
| Eng Review | \`/plan-eng-review\` | Architecture & tests (required) | 0 | — | — |
| Design Review | \`/plan-design-review\` | UI/UX gaps | 0 | — | — |

**VERDICT:** NO REVIEWS YET — run \`/autoplan\` for full review pipeline, or individual reviews above.
\`\`\`

**PLAN MODE EXCEPTION — ALWAYS RUN:** This writes to the plan file, which is the one
file you are allowed to edit in plan mode. The plan file review report is part of the
plan's living status.

# /benchmark-models — Cross-Model Skill Benchmark

You are running the `/benchmark-models` workflow. Wraps the `workflow-model-benchmark` binary with an interactive flow that picks a prompt, confirms providers, previews auth, and runs the benchmark.

Different from `/benchmark` — that skill measures web page performance (Core Web Vitals, load times). This skill measures AI model performance on workflow skills or arbitrary prompts.

---

## Step 0: Locate the binary

```bash
BIN="$HOME/.claude/skills/workflow/bin/workflow-model-benchmark"
[ -x "$BIN" ] || BIN=".claude/skills/workflow/bin/workflow-model-benchmark"
[ -x "$BIN" ] || { echo "ERROR: workflow-model-benchmark not found. Run ./setup in the workflow install dir." >&2; exit 1; }
WORKFLOW_ROOT="$(cd "$(dirname "$BIN")/.." && pwd)"
echo "BIN: $BIN"
echo "WORKFLOW_ROOT: $WORKFLOW_ROOT"
```

If not found, stop and tell the user to reinstall workflow.

---

## Step 1: Choose a prompt

Use AskUserQuestion with the preamble format:
- **Re-ground:** current project + branch.
- **Simplify:** "A cross-model benchmark runs the same prompt through 2-3 AI models and shows you how they compare on speed, cost, and output quality. What prompt should we use?"
- **RECOMMENDATION:** A because benchmarking against a real skill exposes tool-use differences, not just raw generation.
- **Options:**
  - A) Benchmark one of my workflow skills (we'll pick which skill next). Completeness: 10/10.
  - B) Use an inline prompt — type it on the next turn. Completeness: 8/10.
  - C) Point at a prompt file on disk — specify path on the next turn. Completeness: 8/10.

If A: list top-level workflow skills that have `SKILL.md` files from the installed workflow root:

```bash
find "$WORKFLOW_ROOT" -mindepth 2 -maxdepth 2 -name SKILL.md -not -path '*/.*'
```

Ask the user to pick one via a second AskUserQuestion. Use the picked `SKILL.md` path as the prompt file.

If B: ask the user for the inline prompt. Use it verbatim via `--prompt "<text>"`.

If C: ask for the path. Verify it exists. Use as positional argument.

---

## Step 2: Choose providers

```bash
"$BIN" --prompt "unused, dry-run" --models claude,gpt,gemini --dry-run
```

Show the dry-run output. The "Adapter availability" section tells the user which providers will actually run (OK) vs skip (NOT READY — remediation hint included).

If ALL three show NOT READY: stop with a clear message — benchmark can't run without at least one authed provider. Suggest `claude login`, `codex login`, or `gemini login` / `export GOOGLE_API_KEY`.

If at least one is OK: AskUserQuestion:
- **Simplify:** "Which models should we include? The dry-run above showed which are authed. Unauthed ones will be skipped cleanly — they won't abort the batch."
- **RECOMMENDATION:** A (all authed providers) because running as many as possible gives the richest comparison.
- **Options:**
  - A) All authed providers. Completeness: 10/10.
  - B) Only Claude. Completeness: 6/10 (no cross-model signal — use /ship's review for solo claude benchmarks instead).
  - C) Pick two — specify on next turn. Completeness: 8/10.

---

## Step 3: Decide on judge

```bash
[ -n "$ANTHROPIC_API_KEY" ] || grep -q 'ANTHROPIC' "$HOME/.claude/.credentials.json" 2>/dev/null && echo "JUDGE_AVAILABLE" || echo "JUDGE_UNAVAILABLE"
```

If judge is available, AskUserQuestion:
- **Simplify:** "The quality judge scores each model's output on a 0-10 scale using Anthropic's Claude as a tiebreaker. Adds ~$0.05/run. Recommended if you care about output quality, not just latency and cost."
- **RECOMMENDATION:** A — the whole point is comparing quality, not just speed.
- **Options:**
  - A) Enable judge (adds ~$0.05). Completeness: 10/10.
  - B) Skip judge — speed/cost/tokens only. Completeness: 7/10.

If judge is NOT available, skip this question and omit the `--judge` flag.

---

## Step 4: Run the benchmark

Construct the command from Step 1, 2, 3 decisions:

```bash
"$BIN" <prompt-spec> --models <picked-models> [--judge] --output table
```

Where `<prompt-spec>` is either `--prompt "<text>"` (Step 1B), a file path (Step 1A or 1C), and `<picked-models>` is the comma-separated list from Step 2.

Stream the output as it arrives. This is slow — each provider runs the prompt fully. Expect 30s-5min depending on prompt complexity and whether `--judge` is on.

---

## Step 5: Interpret results

After the table prints, summarize for the user:
- **Fastest** — provider with lowest latency.
- **Cheapest** — provider with lowest cost.
- **Highest quality** (if `--judge` ran) — provider with highest score.
- **Best overall** — use judgment. If judge ran: quality-weighted. Otherwise: note the tradeoff the user needs to make.

If any provider hit an error (auth/timeout/rate_limit), call it out with the remediation path.

---

## Step 6: Offer to save results

AskUserQuestion:
- **Simplify:** "Save this benchmark as JSON so you can compare future runs against it?"
- **RECOMMENDATION:** A — skill performance drifts as providers update their models; a saved baseline catches quality regressions.
- **Options:**
  - A) Save to `~/.workflow/benchmarks/<date>-<skill-or-prompt-slug>.json`. Completeness: 10/10.
  - B) Just print, don't save. Completeness: 5/10 (loses trend data).

If A: re-run with `--output json` and tee to the dated file. Print the path so the user can diff future runs against it.

---

## Important Rules

- **Never run a real benchmark without Step 2's dry-run first.** Users need to see auth status before spending API calls.
- **Never hardcode model names.** Always pass providers from user's Step 2 choice — the binary handles the rest.
- **Never auto-include `--judge`.** It adds real cost; user must opt in.
- **If zero providers are authed, STOP.** Don't attempt the benchmark — it produces no useful output.
- **Cost is visible.** Every run shows per-provider cost in the table. Users should see it before the next run.
