# Plan Templates

Ready-to-use templates for common implementation scenarios. Copy the relevant template and fill in the specifics.

## Single File Change

For changes that affect only one file (bug fix, small enhancement, config change).

```markdown
# Plan: [Description]

## Context
- File: [full path]
- Current behavior: [what it does now]
- Desired behavior: [what it should do]

## Tasks

### Task 1: Write/Update Test
- File: [test file path]
- Action: Add test case for [desired behavior]
- Expected: Test file updated, new test case present

### Task 2: Run Tests (RED)
- Command: [test command]
- Expected: New test FAILS (confirms test is meaningful)

### Task 3: Implement Change
- File: [source file path]
- Line: [line number or range]
- Change: [exact modification]
- Rationale: [why this change]

### Task 4: Run Tests (GREEN)
- Command: [test command]
- Expected: All tests pass including new test

### Task 5: Verify & Commit
- Verify: [specific verification command]
- Commit: `git commit -m "[type]: [description]"`
```

## Multi-File Feature

For features spanning multiple files (new endpoint, new component, new module).

```markdown
# Plan: [Feature Name]

## Context
- Goal: [what this feature does]
- Files to create: [list]
- Files to modify: [list]
- Dependencies: [external libs, existing modules]

## Phase 1: Foundation
### Task 1.1: Create Types/Interfaces
- Create: [types file path]
- Contents: [type definitions]
- Verify: `tsc --noEmit` passes

### Task 1.2: Write Unit Tests
- Create: [test file path]
- Test cases: [list of test descriptions]
- Verify: Tests exist and FAIL (RED)

## Phase 2: Implementation
### Task 2.1: Implement Core Logic
- Create/Modify: [file path]
- Function: [function name and signature]
- Verify: Core tests pass (GREEN)

### Task 2.2: Wire Up Integration
- Modify: [integration file path]
- Change: [what to add — import, route, config entry]
- Verify: [integration test or manual check]

### Task 2.3: Run Full Tests
- Command: [full test suite command]
- Expected: All tests pass, no regressions

## Phase 3: Cleanup
### Task 3.1: Verify & Commit
- Run: [lint command]
- Run: [type check command]
- Commit per phase or as single feature commit
```

## Refactoring

For restructuring code without changing behavior.

```markdown
# Plan: Refactor [Description]

## Context
- Current structure: [describe current organization]
- Target structure: [describe desired organization]
- Invariant: Behavior MUST NOT change

## Pre-Refactor Baseline
### Task 0.1: Establish Baseline
- Run: [full test suite]
- Record: [X tests passing, Y% coverage]
- This baseline MUST be matched after refactoring

## Phase 1: Extract
### Task 1.1: Create New Module
- Create: [new file path]
- Extract: [function/class names] from [old file path]
- Verify: New file exists with extracted code

### Task 1.2: Update Imports
- Modify: [each file that imported from old location]
- Change: Import paths to point to new module
- Verify: `tsc --noEmit` passes

### Task 1.3: Run Tests
- Command: [full test suite]
- Expected: Same pass count as baseline (NO changes)

## Phase 2: Clean Up
### Task 2.1: Remove Old Code
- Modify: [old file path]
- Remove: Extracted functions (now in new module)
- Verify: No duplicate code

### Task 2.2: Final Verification
- Run: [full test suite]
- Expected: Exact same results as baseline
- Run: [build command]
- Expected: Clean build

### Task 2.3: Commit
- Commit: `refactor: [description]`
```

## Bug Fix

For fixing a specific reported bug.

```markdown
# Plan: Fix [Bug Description]

## Context
- Bug: [description of incorrect behavior]
- Expected: [correct behavior]
- Reproduction: [steps to reproduce]

## Phase 1: Reproduce
### Task 1.1: Write Failing Test
- File: [test file path]
- Test: Reproduce the bug as a test case
- Run: [test command]
- Expected: Test FAILS (confirms bug exists)

## Phase 2: Investigate
### Task 2.1: Trace Root Cause
- Read: [suspected file paths]
- Grep: [relevant patterns]
- Finding: [root cause — to be filled during execution]

## Phase 3: Fix
### Task 3.1: Implement Fix
- File: [file path — to be confirmed after investigation]
- Change: [fix — to be determined after investigation]
- Verify: Bug reproduction test now PASSES

### Task 3.2: Regression Check
- Run: [full test suite]
- Expected: All tests pass (no regressions)

### Task 3.3: Commit
- Commit: `fix: [description]`
```

## Template Usage Guidelines

1. **Always verify file paths** with Glob before including them in a plan
2. **Fill in ALL placeholders** — `[brackets]` indicate required information
3. **Adjust task count** to match complexity — simple changes need fewer tasks
4. **TDD order is non-negotiable** — test before implement, always
5. **Combine templates** when needed — a feature might include a bug fix sub-plan
