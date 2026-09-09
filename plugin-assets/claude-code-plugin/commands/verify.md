---
description: Verify the changed behavior and required project checks. Use full for comprehensive checks or --goal to trace an outcome through its implementation.
---

# Verification

Inspect the requested scope, current diff, and repository requirements. Select
checks that establish the changed behavior at the relevant risk boundary.

- Run required project checks and the smallest additional check that covers an
  otherwise unverified risk. Do not add tests that merely mirror a low-impact edit.
- Reuse inspected evidence for unchanged candidate, inputs, and relevant
  environment. Repeat or expand checks after relevant changes, failures, or
  unresolved concerns, not merely because a new turn started.
- Follow real command dependencies; independent checks need no fixed order.
  A failed prerequisite blocks its dependents, not unrelated useful checks.
- Check logs or secrets when required by the project or affected boundary.
  Legitimate CLI logging is not a defect merely because it uses `console.log`.
- Report passed, failed, skipped, and unavailable checks accurately. A scoped
  pass does not imply all tests passed or that a PR is ready.

## Arguments

- No argument or `quick`: changed behavior and required project checks.
- `full`: all applicable project build, type, lint, and test checks. Include
  coverage when the project requires it; do not invent a universal percentage.
- `pre-commit`: required commit gates and checks for the staged change.
- `pre-pr`: required delivery checks for the full proposed change.
- `--goal "<goal1>, <goal2>"` or `--goal <file>`: trace each goal from its owner
  through the required entry point, then verify the relevant behavior.

For detailed goal tracing, read
[goal-verification.md](../skills/global/evidence-based-coding/reference/goal-verification.md).

Report the outcome, commands or evidence used, candidate/environment scope, and
material gaps. Do not initiate commit, push, or deployment from this command.
