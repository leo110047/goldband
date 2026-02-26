---
description: Identify gray areas and capture structured decisions before planning.
---

# Discuss Command

Explore ambiguities, surface hidden assumptions, and lock down decisions **before** creating an implementation plan.

## Usage

`/discuss <goal or feature description>`

## When to Use

- Before `/plan` when requirements have gray areas
- When the user describes a feature but key details are unspecified
- When multiple valid approaches exist and the choice matters
- When domain-specific edge cases could derail implementation

## Process

### Step 1: Analyze the Goal

Read the user's goal and identify:
- What is explicitly stated
- What is implicitly assumed
- What is ambiguous or unspecified
- What domain-specific edge cases exist

### Step 2: Identify Gray Areas

For each gray area, categorize it:

- **Must Decide Now** — blocks implementation if left open
- **Can Decide During Implementation** — safe to defer with a default
- **Out of Scope** — interesting but not part of this task

### Step 3: Structured Discussion

For each "Must Decide Now" item, present 3-4 focused questions:

```
GRAY AREA: [topic]
──────────────────
Context: [why this matters]

Options:
  A) [option] — [tradeoff]
  B) [option] — [tradeoff]
  C) [option] — [tradeoff]

Recommendation: [your pick and why]
```

Discuss one gray area at a time. Wait for the user's decision before moving to the next.

### Step 4: Scope Guardrail

If discussion reveals a new feature or significant scope expansion:
- **Do NOT** expand the current task's scope
- **Do** record it as a backlog item
- Say: "That's a great idea but separate from the current goal. I'll note it as a follow-up."

### Step 5: Output Structured Decisions

After all gray areas are resolved, produce a decision summary:

```
DECISIONS LOCKED
================
1. [decision] — [rationale]
2. [decision] — [rationale]

DISCRETIONARY (defaults chosen, can adjust later)
=================================================
1. [area] — default: [value] — [why]

DEFERRED (out of scope for this task)
=====================================
1. [item] — [reason for deferral]

BACKLOG (new ideas surfaced during discussion)
==============================================
1. [idea] — [brief description]
```

## CRITICAL Rules

- **One gray area at a time** — do not overwhelm with all questions at once
- **Always provide a recommendation** — the user can override, but don't force them to think from scratch
- **Scope guardrail is mandatory** — new features go to backlog, never to the current task
- **Decisions are final** — once locked, do not revisit unless the user explicitly asks
- This command produces **decisions**, not code. Use `/plan` after `/discuss`.

## Arguments

$ARGUMENTS:
- The goal or feature to discuss (free text)
- If no arguments provided, ask the user what they'd like to discuss
