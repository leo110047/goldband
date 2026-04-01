# Claim Verification

## Baseline Policy

- Treat repository facts as unverified until they are checked against files, commands, tests, or logs from the current turn.
- Treat current external facts as unverified until they are backed by a cited source. This includes latest versions, docs, prices, rules, and news.
- Do not claim work is complete without fresh verification evidence from the current turn.
- Brainstorming is allowed, but assumptions must be labeled as hypotheses instead of stated as confirmed facts.

## Required Behavior

- For repository claims, cite the exact file path, command, test, or log that supports the statement.
- If evidence is missing, say `unknown`, `not yet verified`, or ask to verify before concluding.
- Do not turn uncertainty into hedged factual language such as "probably", "likely", or "should work" when making completion or correctness claims.
