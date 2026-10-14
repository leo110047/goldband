---
name: planning-workflow
description: |
  Use when turning a request into an implementation plan, especially before
  multi-file changes, refactors, or work that needs explicit phases and
  verification.

  Prefer `/goldband-plan` or workflow planning skills for full implementation plans. This
  portable skill only defines shared planning policy and decision-quality
  requirements.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Planning Workflow

Shared planning policy. `/goldband-plan` and `$goldband plan create` own full
planning.

## Gotchas

- One task holds one action, even when several actions touch the same feature.
- Read current files and constraints before planning implementation steps.
- Each task names its file or artifact and the evidence still needed; generic
  placeholders are not tasks.
- Every task carries its own verification.
- A plan that recommends an architecture or direction includes the
  Decision-Quality Block.

## Workflow Handoff

Use the planning workflow, when installed, for multi-file implementation,
cross-host policy work, refactors, release plans, or work that needs reviewable
phases. Use this skill alone for small plans or when the workflow is not
installed.

## Decision-Quality Block

Include this block when the plan recommends an approach, architecture direction,
tooling direction, refactoring strategy, or project-health priority:

- Recommendation.
- Why it fits now.
- Current requirement, root-cause class, or required safety boundary.
- Smallest sufficient option and its permanent cost.
- For a heavier mechanism, the named gap in the smaller option and current
  evidence for that gap.
- Assumptions that must hold.
- Main failure modes.
- Early warning signals.
- Best alternative and when it becomes better.
- Unknowns still needing verification.

Smallest sufficient does not mean smallest diff. It must preserve authoritative
ownership and required security, permission, data, destructive-action, and
external-side-effect boundaries. Do not recommend a permanent approval, state,
gate, artifact, lineage, coordination workflow, or generic mechanism for
hypothetical completeness; a heavier option needs an explicit requirement,
reachable failure path, boundary invariant, or measured constraint showing why
the smaller option is insufficient.

## Task Requirements

Each task should name:

- File path or artifact involved.
- One concrete action.
- Expected output or observable result.
- Verification command or inspection step.

If a task hides multiple actions, split it. If a path or command is not verified,
say so before presenting the plan as executable.
