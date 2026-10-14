---
name: systematic-debugging
description: |
  Use when encountering any bug, test failure, build failure, or unexpected
  behavior before proposing fixes.

  Prefer the Goldband investigate workflow for full root-cause work. This
  portable skill only defines the shared debugging contract used by both hosts.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Systematic Debugging

Shared debugging policy. The Goldband investigate workflow owns full
investigation.

A fix requires a stated observed symptom, reproduction path, and evidence
source.

## Scope

Investigate a concrete defect before proposing its fix. During a review-only
request, verify and report findings without changing code. A bug report or
keyword does not authorize implementation or override the user's task.

## Gotchas

- A fix attempt is a completed corrective action based on a stated root-cause
  hypothesis, followed by relevant verification.
- Inspection and reruns without a corrective action do not count; neither do
  tool, sandbox, or permission failures that prevent the action from completing
  or verification from running.
- After two consecutive attempts under the same hypothesis leave the same
  verification blocked by the same failure class, stop editing and return to
  diagnosis. Cosmetic output changes do not reset the count; a different
  failure class or new evidence-backed hypothesis does.
- The first plausible cause is a hypothesis; compare against working versions
  and recent changes.
- A non-reproducible issue requires more diagnostics, not a guess.
- Urgency does not waive root-cause work.

## Workflow Handoff

Use the investigate workflow, when installed, for multi-component failures,
production incidents, flaky tests, unclear ownership, or work that needs a
written investigation record. Use this skill alone for small local failures or
when the workflow is not installed.

## Required Sequence

1. Reproduce the issue and capture the exact failure.
2. Gather concrete evidence from errors, logs, diffs, configs, tests, or runtime
   state before proposing a fix.
3. Form one root-cause hypothesis.
4. Apply the healthiest complete fix that addresses that root cause and reduces
   recurrence risk.
5. Verify with the command, test, or runtime path that proves the issue is fixed.

## Evidence Requirements

- Exact failure text or observed behavior.
- Reproduction command or path.
- Evidence for the chosen root cause.
- Fix summary tied to that root cause.
- Verification command and result.
