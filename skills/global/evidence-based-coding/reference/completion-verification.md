# Completion Verification

A completion claim needs evidence that covers the requested outcome on the
current candidate and relevant environment.

## Evidence Validity

Reuse an inspected result when the code or artifact, inputs, dependencies,
configuration, environment, and acceptance requirement relevant to that result
are unchanged. A new conversational turn is not a reason to repeat a test.
For mutable external state, obtain a fresh readback when the claim depends on it.

Run the relevant check again after a change that can invalidate it, a failure,
or an unresolved concern. Complete required repository checks; do not invent
new mandatory suites or tests that merely mirror a low-impact edit.

## Evidence and Claim

- Compare the observed result with the acceptance criteria, including errors and
  skipped paths. An exit code alone may not cover the claimed behavior.
- Confirm a regression test exercises the affected path and can fail on the
  original defect. For TDD, observe the expected failure before the fix.
- An agent report is a lead: inspect the supporting artifact or output before
  accepting it. Do not rerun an unchanged, inspected check solely for formality.
- If a required boundary cannot be exercised, describe what is verified and
  what remains unverified. Do not substitute fixture evidence for live behavior.

The final report should identify the result, useful verification evidence, and
material limitations. It does not need a fixed five-step transcript.
