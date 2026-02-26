---
name: evidence-based-coding
description: |
  Prevent AI hallucinations by enforcing evidence-based coding practices.
  ALWAYS verify assumptions with actual code/files/tests before making claims.

  Use when: suggesting code changes, claiming "this function does X", referencing APIs,
  proposing fixes, or making any statement about the codebase.

  CRITICAL: This skill enforces the principle "Show me the evidence" - never assume, always verify.
priority: CRITICAL
enforced-globally: true
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Evidence-Based Coding - Eliminating AI Hallucinations

## Core Principle

```
NEVER ASSUME. ALWAYS VERIFY.
NO CLAIMS WITHOUT EVIDENCE.
```

**Golden Rule:** If you haven't read the actual code, you don't know what it does.

## When to Use This Skill

**Always active.** This skill should govern ALL coding activities:

- Before suggesting any code change
- Before claiming "this function does X"
- Before saying "the API expects Y"
- Before proposing a fix
- Before stating "file Z exists at path W"
- Before making ANY claim about the codebase

## Priority and Conflict Rules

- **Priority**: CRITICAL - enforced globally across all skills
- All other skills must follow evidence-based approach
- Never assume, always verify -- no exceptions

## The Three Laws of Evidence-Based Coding

### Law 1: Read Before You Speak

**Never make claims about code you haven't read.**

```
BAD:  "The getUserById function probably looks like this..."
      [generates code based on assumptions]

GOOD: [Uses Grep to find getUserById, Read to examine it]
      "I've read getUserById at src/user.service.ts:45.
      It currently does X, and the issue is Y. Here's the fix..."
```

### Law 2: Verify Before You Claim

**Every factual statement must be backed by tool evidence.**

```
BAD:  "This API endpoint expects a JSON body with userId and email fields."
      [Assumption - no evidence]

GOOD: [Read API endpoint code]
      "Looking at src/api/user.ts:23, the endpoint expects:
      { userId: string, email: string, role?: 'user' | 'admin' }"
```

### Law 3: Test, Don't Guess

**Uncertainty requires investigation, not speculation.**

```
BAD:  "This should probably work if we change X to Y"

GOOD: [Make change, run tests]
      "I've changed X to Y. Tests show 15 passing, 1 failing:
      'should handle null values' - we need to add null checking."
```

## Completion Verification — The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.
```

Before claiming ANY task is complete, follow the 5-Step Gate: **IDENTIFY → RUN → READ → VERIFY → CLAIM**.

- Every "done" claim requires fresh tool output from the current turn
- Watch for red-flag phrases: "should work", "probably fine", "Done!"
- Agent reports must be independently verified — agents hallucinate completion

See [reference/completion-verification.md](reference/completion-verification.md) for the full Iron Law, common failure patterns, rationalization prevention, and TDD red-green verification.

## Mandatory Verification Workflows

Step-by-step workflows for verifying code changes, function behavior, and file paths before making any claims.

See [reference/verification-workflows.md](reference/verification-workflows.md) for complete workflows including:
- Before Suggesting Code Changes (search, read, understand, then propose)
- Before Claiming "This Function Does X" (find, read, check tests, then describe)
- Before Claiming File Paths (glob, read, then reference)
- Evidence Collection Workflows for understanding functions, proposing API changes, and debugging errors

## Common Hallucination Patterns

The five most dangerous patterns: inventing API signatures, assuming without testing, guessing at configuration, fabricating error messages, and inventing file structures.

See [reference/hallucination-patterns.md](reference/hallucination-patterns.md) for all 5 patterns with full before/after examples, plus 5 red flags that indicate you are likely hallucinating.

## Verification Checklist

Before making ANY claim, verify:

**File/Path Claims:**
- [ ] Used Glob to verify file exists
- [ ] Used Read to confirm contents
- [ ] Path is exact, not guessed

**Function/API Claims:**
- [ ] Used Grep to find function
- [ ] Used Read to examine implementation
- [ ] Checked tests to understand behavior

**Configuration Claims:**
- [ ] Read actual config files
- [ ] Checked environment variable usage
- [ ] Verified against documentation

**Error/Bug Claims:**
- [ ] Read error message completely
- [ ] Found error source with Grep
- [ ] Read surrounding context
- [ ] Checked for related issues

**Fix Proposals:**
- [ ] Read code being fixed
- [ ] Understand root cause
- [ ] Ran tests after fix
- [ ] Verified fix resolves issue

## Anti-Hallucination Mantras

Repeat these before every suggestion:

1. **"Have I read the actual code?"**
   - If no -> Use Grep + Read first

2. **"Am I making assumptions?"**
   - If yes -> Verify with tools

3. **"Can I point to specific files/lines?"**
   - If no -> You're probably hallucinating

4. **"Did I test this claim?"**
   - If no -> Run tests or verify

5. **"Would this be obvious to someone who read the code?"**
   - If no -> Read the code yourself

## The Ultimate Rule

```
IF YOU HAVEN'T READ IT, YOU DON'T KNOW IT.
IF YOU DON'T KNOW IT, DON'T CLAIM IT.
IF YOU'RE UNCERTAIN, INVESTIGATE.
```

**NO EXCEPTIONS.**
