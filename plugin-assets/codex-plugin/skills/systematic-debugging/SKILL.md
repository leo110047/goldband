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

This is a thin shared-policy entrypoint. The full investigation workflow belongs
in the Goldband investigate workflow so Claude and Codex do not carry duplicate
debugging playbooks in portable skills.

## The Iron Law

No fixes without root-cause investigation first.

If you cannot state the observed symptom, reproduction path, and evidence source,
you are not ready to propose a fix.

## Scope

Investigate a concrete defect before proposing its fix. During a review-only
request, verify and report findings without changing code. A bug report or
keyword does not authorize implementation or override the user's task.

## Gotchas

- Do not propose a fix before you can state the observed symptom, reproduction
  path, and evidence source.
- A fix attempt is a completed corrective action based on a stated root-cause
  hypothesis, followed by relevant verification.
- Inspection and reruns without a corrective action do not count; neither do
  tool, sandbox, or permission failures that prevent the action from completing
  or verification from running.
- After two consecutive attempts under the same hypothesis leave the same
  verification blocked by the same failure class, stop editing and return to
  diagnosis. Cosmetic output changes do not reset the count; a different
  failure class or new evidence-backed hypothesis does.
- Do not stop at the first plausible cause; compare against working examples and
  recent changes.
- Do not treat a non-reproducible issue as permission to guess. Gather more
  diagnostics until the pattern sharpens.
- Do not let urgency override root-cause work. Time pressure is when thrashing is
  most expensive.

## Workflow Handoff

Use the Goldband investigate workflow when available for multi-component
failures, production incidents, flaky tests, unclear ownership, or work that
needs a written investigation record.

Use this skill directly only for small local failures or when workflow is not
installed.

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
