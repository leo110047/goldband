---
description: Run build, type, lint, test, and console.log checks. Supports --goal for three-level goal-backward verification.
---

# Verification Command

Run comprehensive verification on current codebase state.

## Instructions

Execute verification in this exact order:

1. **Build Check**
   - Run the build command for this project
   - If it fails, report errors and STOP

2. **Type Check**
   - Run TypeScript/type checker
   - Report all errors with file:line

3. **Lint Check**
   - Run linter
   - Report warnings and errors

4. **Test Suite**
   - Run all tests
   - Report pass/fail count
   - Report coverage percentage

5. **Console.log Audit**
   - Search for console.log in source files
   - Report locations

6. **Git Status**
   - Show uncommitted changes
   - Show files modified since last commit

## Output

Produce a concise verification report:

```
VERIFICATION: [PASS/FAIL]

Build:    [OK/FAIL]
Types:    [OK/X errors]
Lint:     [OK/X issues]
Tests:    [X/Y passed, Z% coverage]
Logs:     [OK/X console.logs]
Git:      [clean/X uncommitted files]

Ready for PR: [YES/NO]
```

If any critical issues, list them with fix suggestions.

## Goal-Backward Verification (when `--goal` is provided)

When invoked with `--goal`, perform three-level verification for each stated goal.

### Three Levels

1. **EXISTS** — Search for code addressing the goal (Grep/Glob)
2. **SUBSTANTIVE** — Read the implementation; scan for anti-patterns:
   - `TODO|FIXME|PLACEHOLDER|HACK|XXX`
   - `return null|return {}|return []|return undefined`
   - `=> {}|throw new Error('not implemented')`
3. **WIRED** — Trace from entry point (route/UI/CLI) to implementation; verify the code is reachable

### Output

```
GOAL VERIFICATION
=================
| Goal | EXISTS | SUBSTANTIVE | WIRED | Status |
|------|--------|-------------|-------|--------|
| [goal] | ✓/✗ location | ✓/✗ detail | ✓/✗ detail | VERIFIED/STUBBED/MISSING/DEAD CODE |

OVERALL: X/Y goals verified
BLOCKING: [unverified goals]
```

### Process

For each goal in `$ARGUMENTS` after `--goal`:
1. Parse goals (comma-separated or from a file if path is given)
2. For each goal, run EXISTS → SUBSTANTIVE → WIRED checks in order
3. Stop early if a level fails (no point checking WIRED if SUBSTANTIVE failed)
4. Report per the table format above

See [goal-verification.md](../skills/global/evidence-based-coding/reference/goal-verification.md) for the complete methodology, anti-pattern catalog, and walkthrough examples.

## Arguments

$ARGUMENTS can be:
- `quick` - Only build + types
- `full` - All checks (default)
- `pre-commit` - Checks relevant for commits (build + types + lint + console.log audit)
- `pre-pr` - Full checks plus security scan (check for hardcoded secrets)
- `--goal "<goal1>, <goal2>"` - Goal-backward verification for specific goals
- `--goal <file>` - Read goals from a file (one per line) and verify each
