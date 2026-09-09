# Claim Verification

## Baseline Policy

- Treat repository facts as unverified until they are checked against files, commands, tests, or logs that cover the current candidate and relevant environment.
- Treat current external facts as unverified until they are backed by a cited source. This includes latest versions, docs, prices, rules, and news.
- Completion claims need valid evidence for the requested outcome. Reuse inspected results while the candidate, inputs, relevant environment, and requirements are unchanged; a new conversational turn alone does not invalidate them. Repeat or broaden checks only after relevant changes, failures, or unresolved concerns, while completing required repository checks.
- Brainstorming is allowed, but assumptions must be labeled as hypotheses instead of stated as confirmed facts.

## Required Behavior

- Verify repository claims against an exact file path, command, test, or log.
  In user-facing output, include the evidence needed to support the conclusion;
  do not attach a path or line number to every sentence when it adds no value.
- If evidence is missing, say `unknown`, `not yet verified`, or ask to verify before concluding.
- Do not turn uncertainty into hedged factual language such as "probably", "likely", or "should work" when making completion or correctness claims.
- Match the proof method to the claim: use code and configuration inspection
  for static structure, and live execution for runtime behavior. Neither is a
  substitute for the other.
- Match the evidence to the boundary being claimed. Code reading, type checking,
  and mocks cannot prove live provider, approval, interrupt, file-change,
  authentication, process-lifecycle, or platform behavior.
- Use the real execution boundary for authentication and runtime support checks.
  A sandbox that cannot see host credentials is not evidence that the host is
  logged out, and one operating system or compatibility runtime is not proof of
  another platform.
- A test counts as evidence only when it can fail for the incident or contract
  regression it claims to cover. Trivial execution and assertions unrelated to
  the risk are not verification.
