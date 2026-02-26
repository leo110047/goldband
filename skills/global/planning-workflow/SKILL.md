---
name: planning-workflow
description: |
  Structured planning templates for implementation tasks.
  Use when: creating implementation plans with /plan, breaking down features into verifiable steps.

  Ensures plans are precise, verifiable, and follow evidence-based principles.
  Every task must be small enough to verify, every step must include expected outcomes.
priority: MEDIUM
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Planning Workflow — Structured Task Breakdown

## Core Principle

```
A PLAN IS ONLY AS GOOD AS ITS MOST AMBIGUOUS STEP.
```

Vague plans produce vague results. Every step must be concrete enough that a fresh agent with no prior context could execute it correctly.

## When to Use This Skill

- Creating implementation plans with `/plan`
- Breaking down features into development tasks
- Structuring work for subagent execution
- Any multi-step implementation that will take more than 10 minutes

## Task Granularity

Each task in a plan should take **2-5 minutes** to execute. If a task feels like it will take longer, break it down further.

**One task = One action.** A task should do exactly one of:
- Create a file
- Modify a file
- Run a command and verify output
- Write a test
- Commit a change

### Bad vs Good Granularity

```
BAD:  "Implement user authentication"
      (too large — could take hours, unclear where to start)

GOOD: Task 1: Create src/auth/types.ts with User and Session types
      Task 2: Write test for validateToken in src/auth/__tests__/validate.test.ts
      Task 3: Implement validateToken in src/auth/validate.ts to pass test
      Task 4: Run tests, verify 4/4 passing
      Task 5: Commit "feat: add token validation"
```

## Task Structure

Every task must specify:

### 1. Files

What files are involved and what happens to each:

```
Files:
  Create: src/utils/parser.ts
  Modify: src/index.ts (add import + usage)
  Test:   src/utils/__tests__/parser.test.ts
```

### 2. Steps

Concrete steps with expected outcomes:

```
Steps:
  1. Write test in parser.test.ts
     → Expected: test file created, 3 test cases
  2. Run tests
     → Expected: 3 failing (RED)
  3. Implement parser.ts
     → Expected: parseInput function exported
  4. Run tests
     → Expected: 3 passing (GREEN)
  5. Commit
     → Expected: clean commit with test + implementation
```

### 3. Verification

How to confirm the task is done:

```
Verify:
  - npm test -- --grep "parser" → 3/3 passing
  - grep -r "parseInput" src/index.ts → import present
  - node -e "require('./src/utils/parser')" → no errors
```

## Precision Requirements

### File Paths Must Be Complete

```
BAD:  "Update the config file"
GOOD: "Update src/config/database.ts line 23: change poolSize from 5 to 10"
```

### Code Must Be Complete

```
BAD:  "Add a function to parse dates"
GOOD: "Add to src/utils/date.ts:
       export function parseISO(input: string): Date {
         const d = new Date(input);
         if (isNaN(d.getTime())) throw new Error(`Invalid date: ${input}`);
         return d;
       }"
```

### Commands Must Include Expected Output

```
BAD:  "Run the tests"
GOOD: "Run: npm test -- --grep 'parseISO'
       Expected: 'Tests: 3 passed, 3 total'"
```

## Plan Quality Checklist

Before presenting a plan to the user, verify:

- [ ] Every task takes 2-5 minutes max
- [ ] Every task has exactly one action
- [ ] Every file path is complete and verified with Glob
- [ ] Every modification specifies what changes and where
- [ ] Every task has a verification step
- [ ] Tasks follow TDD order where applicable (test → fail → implement → pass)
- [ ] Dependencies between tasks are explicit
- [ ] No task requires information not available at execution time

## Integration with /plan Command

When `/plan` activates, this skill provides the structure. The workflow is:

1. `/discuss` (optional) → resolve ambiguities
2. `/plan` → apply this skill's templates to create a structured plan
3. User approves → execute tasks in order
4. Each task completion → verify per the Iron Law

See [reference/plan-templates.md](reference/plan-templates.md) for ready-to-use templates for common scenarios.

## Common Planning Mistakes

| Mistake | Why It Fails | Fix |
|---------|-------------|-----|
| "Implement the feature" as one task | Too large, unclear stopping point | Break into 5-10 tasks of 2-5 min each |
| No file paths in tasks | Implementer has to search | Include verified paths |
| No expected output | Can't verify completion | Add expected output for every command |
| Tests after implementation | Doesn't catch regressions | Write tests first (TDD) |
| No verification step | "Done" becomes a feeling | Every task ends with verification |
| Assuming file structure | Files may not exist where expected | Glob/Read before planning |
