---
name: goldband-openclaw-investigate
description: Use when asked to debug, fix a bug, investigate an error, or do root cause analysis, and when users report errors, stack traces, unexpected behavior, or say something stopped working.
---

# Systematic Debugging

A fix requires a confirmed root cause: a specific, testable claim about what is
wrong and why, backed by evidence.

## Phase 1: Root Cause Investigation

1. **Symptoms:** read error messages, stack traces, and reproduction steps. When
   context is missing, ask one question at a time.
2. **Code path:** trace from the symptom to candidate causes, reading every
   relevant reference.
3. **Recent changes:** `git log --oneline -20 -- <affected-files>`. A regression
   places the cause in the diff since the last working state.
4. **Reproduction:** trigger the failure deterministically, or gather more
   evidence before continuing.
5. **Memory:** check prior debugging sessions on the same area; recurring bugs
   in the same files indicate an architectural cause.

Output: **"Root cause hypothesis: ..."**

## Phase 2: Pattern Analysis

Compare the symptom with known failure classes: race conditions, null
propagation, state corruption, integration failures, configuration drift
between environments, and stale caches. Check the project's known issues and
prior fixes in the same area.

When no known class matches, search externally for the error category, never
the raw message, after removing hostnames, IPs, file paths, SQL, and customer
data.

## Phase 3: Hypothesis Testing

1. Confirm the hypothesis with temporary instrumentation at the suspected cause
   and a reproduction run.
2. A disproved hypothesis returns to Phase 1 with new evidence.
3. After three disproved hypotheses, or when no evidence-backed hypothesis
   remains, stop and report to the user with three options: a new hypothesis,
   human escalation, or added instrumentation.

A temporary fix, a fix proposed before the data flow is traced, or fixes that
each reveal a new problem elsewhere indicate the wrong layer.

## Phase 4: Implementation

1. Fix the root cause with the smallest change that eliminates it; no adjacent
   refactoring.
2. Add a regression test that fails without the fix and passes with it.
3. Run the full test suite.
4. A fix touching more than five files is reported to the user before
   proceeding.
5. After two fix attempts under the same hypothesis leave verification blocked
   by the same failure class, stop editing and return to Phase 1.

## Phase 5: Verification and Report

Reproduce the original scenario to confirm the fix, run the test suite, and
report:

**DEBUG REPORT**
- **Symptom:** what the user observed
- **Root cause:** what was wrong
- **Fix:** what changed, with file references
- **Evidence:** test output and the reproduction showing the fix
- **Regression test:** location of the new test
- **Related:** prior bugs in the same area, architectural notes
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED

Save the report to `memory/` with today's date.

## Completion Status

- DONE: root cause found, fix applied, regression test written, all tests pass.
- DONE_WITH_CONCERNS: fix applied but not fully verifiable in the available
  environment.
- BLOCKED: root cause unconfirmed after investigation; escalated.

A fix that cannot be reproduced and verified is not shipped, and an unverified
fix is not described as working.
