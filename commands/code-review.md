---
description: Two-stage code review — spec compliance (--spec) and code quality. Security-first, blocks on CRITICAL/HIGH issues.
---

# Code Review

Comprehensive security and quality review of uncommitted changes.

## Arguments

$ARGUMENTS can be:
- (none) — Run Stage 2 only (Code Quality Review)
- `--spec` — Run both Stage 1 (Spec Compliance) and Stage 2 (Code Quality)
- `--spec <file>` — Run Stage 1 using a specific requirements file, then Stage 2

---

## Stage 1: Spec Compliance Review (when `--spec` is provided)

**Core Principle: Do Not Trust the Report — Read the Actual Code.**

### Process

1. Identify the spec/requirements source:
   - If `--spec <file>` is given, read that file
   - If `--spec` alone, look for: `.claude/plans/*.md`, PR description, or ask the user
2. For EACH requirement in the spec:
   - **Find**: Locate the implementation (Grep/Glob for relevant code)
   - **Read**: Read the actual implementation code
   - **Verify**: Does the code actually fulfill the requirement? Not "does it look like it does" — does it?
   - **Note**: Record status (Implemented / Partial / Missing / Incorrect / Extra)

3. Generate a requirements compliance table:

```
SPEC COMPLIANCE REVIEW
======================
| # | Requirement | Status | Location | Notes |
|---|-------------|--------|----------|-------|
| 1 | [req text]  | [status] | file:line | [detail] |
```

4. Check for:
   - **Missing**: Requirements that have no implementation
   - **Incorrect**: Implementation that misunderstands the requirement
   - **Extra**: Implementation that wasn't requested (scope creep)
   - **Partial**: Implementation that covers only part of a requirement

5. **BLOCK** if any requirement is Missing or Incorrect.

See [spec-review-template.md](../skills/global/code-review-skill/reference/spec-review-template.md) for the full template and guidelines.

---

## Stage 2: Code Quality Review

1. Get changed files: `git diff --name-only HEAD`

2. For each changed file, check for:

**Security Issues (CRITICAL):**
- Hardcoded credentials, API keys, tokens
- SQL injection vulnerabilities
- XSS vulnerabilities
- Missing input validation
- Insecure dependencies
- Path traversal risks

**Code Quality (HIGH):**
- Functions > 50 lines
- Files > 800 lines
- Nesting depth > 4 levels
- Missing error handling
- console.log statements
- TODO/FIXME comments
- Missing JSDoc for public APIs

**Best Practices (MEDIUM):**
- Mutation patterns (use immutable instead)
- Emoji usage in code/comments
- Missing tests for new code
- Accessibility issues (a11y)

3. Generate report with:
   - Severity: CRITICAL, HIGH, MEDIUM, LOW
   - File location and line numbers
   - Issue description
   - Suggested fix

4. Block commit if CRITICAL or HIGH issues found

Never approve code with security vulnerabilities!
