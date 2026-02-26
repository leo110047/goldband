# Completion Verification — The Iron Law

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.
```

"Done" is not a feeling. It is a state proven by tool output obtained **in the current turn**.

## The 5-Step Gate

Every task completion MUST follow these steps in order:

### Step 1: IDENTIFY

List the concrete, observable outcomes that define "done" for this task.

- What files were created or modified?
- What tests must pass?
- What commands must succeed?
- What behavior must be observable?

### Step 2: RUN

Execute the verification commands **right now** — not from memory, not from a previous run.

```
WRONG:  "Tests passed earlier"
CORRECT: [Run tests now, read output]
```

### Step 3: READ

Read the actual output of every verification command. Do not skim. Do not assume.

### Step 4: VERIFY

Compare actual output against the expected outcomes from Step 1. Every outcome must have a matching piece of evidence.

### Step 5: CLAIM

Only after Steps 1-4 are complete with all outcomes verified, make the completion claim. Include evidence references.

```
WRONG:  "Done! All tests pass."
CORRECT: "Completed. Verification:
  - Tests: 42 passing, 0 failing (npm test output above)
  - Build: clean (npm run build output above)
  - Lint: 0 errors (eslint output above)
  - New file exists: src/utils/parser.ts (Glob confirmed)"
```

## Common Failures

| Claim | Required Evidence | Common Shortcut (WRONG) |
|-------|-------------------|-------------------------|
| "Tests pass" | Fresh `npm test` output showing all green | "Tests passed earlier" / "Should pass" |
| "Linter clean" | Fresh lint output with 0 errors | "I followed the style" |
| "Bug fixed" | Reproduction steps no longer trigger bug | "The code looks correct now" |
| "Feature complete" | Each requirement verified independently | "I implemented everything" |
| "Agent completed" | Read agent output + verify deliverables | "The agent said it's done" |

## Red Flags

If you catch yourself thinking or saying any of these, STOP and run verification:

- "should work"
- "probably fine"
- "looks correct"
- "I believe this is done"
- "Great!"
- "Done!"
- "All set!"
- "That should do it"
- "I think we're good"

These are **feelings**, not **evidence**.

## Rationalization Prevention

| Rationalization | Why It's Wrong | What To Do Instead |
|-----------------|----------------|---------------------|
| "I just wrote the code, it must be right" | Writing code and verifying code are different acts | Run the tests |
| "The change was trivial" | Trivial changes cause non-trivial bugs | Run the tests |
| "I already verified the pattern works" | This instance may differ | Verify this specific instance |
| "The test was passing before my change" | Your change may have broken it | Run the tests again |
| "The agent reported success" | Agents hallucinate completion | Read agent output + verify independently |

## TDD Red-Green Verification

When following TDD, the verification pattern is built-in:

```
1. Write test → Run → MUST SEE RED (failure)
   Evidence: test output showing expected failure

2. Implement → Run → MUST SEE GREEN (pass)
   Evidence: test output showing new test passes + no regressions

3. Refactor → Run → MUST STAY GREEN
   Evidence: test output showing all tests still pass
```

If you skip Step 1 (seeing red), you cannot be sure Step 2 (green) is meaningful.

## Integration with The Three Laws

This verification gate is the **final checkpoint** of evidence-based coding:

- **Law 1 (Read Before You Speak)** ensures you understand the code
- **Law 2 (Verify Before You Claim)** ensures your statements are backed by evidence
- **Law 3 (Test, Don't Guess)** ensures uncertainty triggers investigation
- **The Iron Law** ensures completion claims meet the same standard

Together: **No assumptions at any stage. No exceptions at the finish line.**
