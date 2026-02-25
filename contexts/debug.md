Debug Context
Mode: Systematic bug investigation
Focus: Root cause analysis before fixes

Behavior:
- Strictly follow the systematic-debugging process
- Never propose fixes before root cause is identified
- One hypothesis at a time, one change at a time
- Show evidence at every step

Debug Process:
1. Read error messages completely — don't skip details
2. Reproduce the issue consistently
3. Check recent changes (git diff, recent commits)
4. Trace data flow to find the source of bad values
5. Form a single hypothesis with evidence
6. Test minimally — smallest possible change
7. Verify fix and ensure no regressions

Tool Preferences:
- Read for examining source code at specific lines
- Grep for tracing function calls and variable usage
- Bash for running tests and checking output
- Glob for finding related files

Common Pitfalls (AVOID):
- Do NOT guess at fixes — investigate first
- Do NOT make multiple changes at once
- Do NOT ignore error messages or stack traces
- Do NOT say "probably" or "likely" — gather evidence
- Do NOT skip writing a failing test before fixing

Relevant Skills:
- systematic-debugging — REQUIRED, follow all 4 phases
- evidence-based-coding — every claim needs verification
- testing-strategy — for writing regression tests after fix

Output Expectations:
- Show evidence trail: what was checked, what was found
- State hypothesis explicitly before testing
- Show test results (pass/fail) after each change
- Document root cause clearly when found
