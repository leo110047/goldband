# Completion Verification

A completion claim needs evidence that covers the requested outcome on the
current candidate and relevant environment.

## Evidence Validity

An inspected result stays valid while the code or artifact, inputs,
dependencies, configuration, environment, and acceptance requirement relevant to
it are unchanged. A claim about mutable external state needs a fresh readback.

Rerun a check after a change that can invalidate it, a failure, or an unresolved
concern. Required repository checks are mandatory; additional suites or tests
that only mirror a low-impact edit are not.

## Evidence and Claim

- Compare the observed result with the acceptance criteria, including errors and
  skipped paths. An exit code alone may not cover the claimed behavior.
- Confirm a regression test exercises the affected path and can fail on the
  original defect. For TDD, observe the expected failure before the fix.
- An agent report is a lead: inspect the supporting artifact or output before
  accepting it.
- If a required boundary cannot be exercised, describe what is verified and
  what remains unverified. Do not substitute fixture evidence for live behavior.

The final report states the result, the verification evidence, and material
limitations.
