---
name: subagent-development
description: |
  Use when a task can be isolated into a fresh-context subagent, parallelized safely,
  or reviewed in two stages for spec compliance and code quality.

  Best fit for self-contained work, not shared-context debugging.
priority: MEDIUM
allowed-tools:
  - Task
  - Read
  - Grep
  - Glob
  - Bash
---

# Subagent Development — Fresh Context Per Task

## Core Principle

```
EVERY SUBAGENT STARTS FRESH. EVERY DELIVERABLE GETS REVIEWED.
TRUST THE PATTERN, NOT THE REPORT.
```

Subagents are powerful because they operate with clean context — no accumulated assumptions, no stale state. But their output must be verified, because they also lack your accumulated understanding.

## When to Use Subagents

### Decision Tree

```
Is the task self-contained?
  ├─ NO → Do it yourself (shared context needed)
  └─ YES → Can it be described in one clear prompt?
              ├─ NO → Break it down first, then subagent each part
              └─ YES → Does it benefit from fresh context?
                         ├─ YES → Use a subagent ✓
                         └─ NO → Still consider subagent if:
                                  - You want parallel execution
                                  - Current context is crowded
                                  - Task is low-risk and well-defined
```

### Good Candidates

- Implementing a single file or function with clear specs
- Writing tests for existing code
- Refactoring a module with clear before/after
- Generating boilerplate from a template
- Running analysis or search tasks
- Code review of specific changes

### Bad Candidates

- Tasks requiring conversation history context
- Tasks where the approach isn't clear yet
- Debugging that requires iterative investigation
- Tasks that depend on unfinished work

## Fresh Context Per Task

**Why fresh context matters:**

1. No accumulated assumptions from previous tasks
2. No context pollution from unrelated code
3. Prompt is the single source of truth
4. Reproducible — same prompt, same approach

**The tradeoff:** Fresh context means the subagent doesn't know what you know. You must include everything it needs in the prompt.

## Per-Task Workflow

### 1. Dispatch

Write a complete prompt that includes:
- **Goal**: What to build/change (one sentence)
- **Context**: Files to read, patterns to follow, constraints
- **Deliverables**: Exact files to create/modify
- **Verification**: How the subagent should verify its own work
- **Boundaries**: What NOT to change

### 2. Implement (Subagent Executes)

The subagent works autonomously. It should:
- Read all context files before starting
- Follow existing patterns in the codebase
- Write tests before implementation (if applicable)
- Run verification before reporting completion

### 3. Spec Review (You Verify)

**Do Not Trust the Report.** After the subagent completes:

1. Read every file the subagent created or modified
2. For each requirement in the original prompt:
   - Is it implemented? (not "does the agent say it is" — do you see it in code?)
   - Is it correct? (does the implementation match the intent?)
   - Is it complete? (edge cases, error handling, all specified behavior?)
3. Check for extras — did the subagent add unrequested functionality?

### 4. Quality Review

After spec compliance is confirmed:

1. **Strengths**: What did the subagent do well?
2. **Critical Issues**: Security vulnerabilities, data loss risks, incorrect logic
3. **Important Issues**: Performance problems, missing error handling, poor patterns
4. **Minor Issues**: Naming, style, documentation
5. **Assessment**: ACCEPT / REVISE / REJECT

### 5. Complete or Iterate

- **ACCEPT**: Merge the changes, move to next task
- **REVISE**: Create a follow-up subagent task with specific fixes
- **REJECT**: Rewrite the prompt and dispatch a new subagent

## Prompt Engineering for Subagents

### The Implementer Prompt Template

```
You are implementing a specific task. Read all context files before starting.

## Goal
[One clear sentence describing what to build]

## Context Files (Read these FIRST)
- [file path 1] — [what to learn from it]
- [file path 2] — [what to learn from it]

## Existing Patterns to Follow
- [pattern description with file:line reference]

## Requirements
1. [Requirement 1 — specific and verifiable]
2. [Requirement 2 — specific and verifiable]
3. [Requirement 3 — specific and verifiable]

## Deliverables
- Create: [file path] — [description]
- Modify: [file path] — [what to change]
- Test: [test file path] — [what to test]

## Verification
After implementation, run:
- [command 1] → expected: [output]
- [command 2] → expected: [output]

## Boundaries
- Do NOT modify: [files/directories to leave alone]
- Do NOT add: [unrequested features/dependencies]
```

### The Spec Reviewer Prompt Template

```
You are reviewing code for spec compliance. Your job is to verify that
the implementation matches the requirements — not to trust the implementer's report.

## Original Requirements
[paste the original requirements]

## Files to Review
[list of files created/modified]

## Review Process
For each requirement:
1. Find the implementation in actual code
2. Read the implementation (not just the function name)
3. Verify it fulfills the requirement
4. Note: Implemented / Partial / Missing / Incorrect

Output a compliance table and verdict (PASS / FAIL).
```

### The Code Quality Reviewer Prompt Template

```
You are reviewing code quality. Read each file carefully and provide:

## Files to Review
[list of files]

## Review Categories
1. **Strengths** — What's done well
2. **Critical** — Security, correctness, data integrity issues
3. **Important** — Performance, error handling, architecture
4. **Minor** — Style, naming, documentation

## Assessment
ACCEPT / REVISE (with specific items to fix) / REJECT (with rationale)
```

See [reference/prompt-templates.md](reference/prompt-templates.md) for expanded templates with examples.

## Anti-Patterns

### 1. Skipping Review

```
BAD:  "The subagent said it's done, moving on."
GOOD: [Read every file the subagent touched, verify each requirement]
```

The most common failure mode. Subagents report success even when implementation is incomplete or incorrect.

### 2. Trusting the Agent Report

```
BAD:  "The agent says all tests pass."
GOOD: [Run the tests yourself and read the output]
```

Agent reports are claims, not evidence. Apply the Iron Law.

### 3. Too Many Parallel Subagents

```
BAD:  Dispatch 5 subagents at once for interdependent tasks
GOOD: Dispatch 2-3 independent tasks, review, then dispatch next batch
```

Parallel subagents work well for independent tasks. For tasks with dependencies, execute sequentially.

### 4. Vague Prompts

```
BAD:  "Implement the auth module"
GOOD: [Full implementer prompt template with all sections filled]
```

A vague prompt produces vague results. The prompt IS the spec.

### 5. Re-dispatching Without Diagnosis

```
BAD:  "That didn't work, try again" [same prompt]
GOOD: [Analyze what went wrong, update the prompt, dispatch with fixes]
```

If a subagent fails, the prompt was insufficient. Fix the prompt, not just the subagent.

## Integration with Other Skills

- **planning-workflow**: Break plans into subagent-sized tasks (2-5 min each)
- **evidence-based-coding**: Apply the Iron Law to all subagent output
- **code-review-skill**: Use the two-stage review for subagent deliverables
