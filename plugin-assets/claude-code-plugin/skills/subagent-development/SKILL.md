---
name: subagent-development
description: |
  Use when a task can be isolated into a fresh-context subagent or parallelized
  safely, and its result needs review against the original requirements.

  Best fit for self-contained work, not shared-context debugging.
allowed-tools:
  - Task
  - Read
  - Grep
  - Glob
  - Bash
---

# Subagent Development

Delegate only when the host surface and task policy allow it and the work is
independent, bounded, and specifiable without hidden conversation context.

## Use When

- The subtask has a clear owner, files, and expected output.
- It runs without touching shared state or blocking the next local step.
- Fresh context improves focus, review quality, or search breadth.
- The result is verifiable from files, commands, or tests.

## Avoid When

- The task is shared-context debugging, unresolved architecture, or an active
  incident whose next step depends on the current investigation.
- Another worker edits the same files.
- Safe execution needs long unstated context.
- No measurable speed or quality benefit exists.

## Dispatch Contract

The prompt contains only what the worker needs:

- Goal: one sentence.
- Scope: exact files, module, or responsibility.
- Context: files to read and patterns to follow.
- Deliverable: what to change or report.
- Boundaries: files, side effects, and scope expansions to avoid.
- Verification: commands or evidence required before reporting completion.

Workers share the codebase with others: they must not revert others' changes and
must adapt to concurrent work.

## Review Contract

A completion report is not evidence. Before accepting it:

- Read every changed file or cited evidence path.
- Map the result to the original requirements.
- Rerun or inspect the relevant verification.
- Check for unrequested scope expansion.

When the result is incomplete, identify what the prompt omitted before
re-dispatching.
