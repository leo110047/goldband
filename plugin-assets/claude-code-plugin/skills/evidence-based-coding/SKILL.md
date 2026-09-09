---
name: evidence-based-coding
description: Ground code, configuration, and completion claims in evidence for the current candidate and relevant environment. Use when inspecting, changing, or reporting repository behavior.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Evidence-Based Coding

Check the authoritative code, configuration, output, or logs before making a
claim. Match the evidence to the scope and boundary being claimed.

- Read relevant context behind search results and agent reports.
- Static inspection proves structure; mocks and type checks do not establish
  live provider, authorization, process, platform, or deployment behavior.
- Evidence may be reused when it still covers the same candidate, inputs,
  relevant environment, and requirement. A new conversational turn alone does
  not invalidate it. Recheck state that may have changed.
- Run checks required by the repository and the changed risk. Repeat or broaden
  them only after relevant changes, failures, or unresolved concerns.
- Never weaken, skip, or delete an assertion, test, type, or lint rule to pass.
  Correct a wrong gate together with its stated policy and regression coverage.
- Report unavailable verification, partial results, and assumptions explicitly.
  Do not turn a plausible result or another agent's summary into a verified fact.

Load only the reference needed:

- `reference/completion-verification.md`: evidence reuse and completion.
- `reference/verification-workflows.md`: choosing proof for a claim.
- `reference/hallucination-patterns.md`: misleading evidence patterns.
- `reference/goal-verification.md`: tracing a requested outcome to behavior.
