---
description: Restate requirements, assess risks, and create step-by-step implementation plan. WAIT for user CONFIRM before touching any code.
---

# Plan Command

Create a comprehensive implementation plan before writing any code.

## Process

1. **Restate Requirements** - Clarify what needs to be built
2. **Explore Codebase** - Read relevant files to understand current architecture
3. **Break Down into Phases** - Specific, actionable steps with dependencies
4. **Assess Risks** - Surface potential issues and blockers
5. **Estimate Complexity** - High / Medium / Low
6. **WAIT for Confirmation** - MUST receive user approval before proceeding

## When to Use

- Starting a new feature
- Making significant architectural changes
- Working on complex refactoring
- Multiple files/components will be affected
- Requirements are unclear or ambiguous

## Output Format

```
# Implementation Plan: [Feature Name]

## Requirements Restatement
- [Bullet points restating what needs to be built]

## Implementation Phases

### Phase 1: [Name]
- [Step 1]
- [Step 2]

### Phase 2: [Name]
- [Step 1]
- [Step 2]

## Dependencies
- [External services, libraries, etc.]

## Risks
- HIGH: [Risk description]
- MEDIUM: [Risk description]
- LOW: [Risk description]

## Estimated Complexity: [HIGH/MEDIUM/LOW]

**WAITING FOR CONFIRMATION**: Proceed with this plan? (yes/no/modify)
```

## CRITICAL Rules

- **NEVER** write code until user explicitly confirms with "yes" or "proceed"
- Always verify assumptions with actual code (Read, Grep, Glob) before planning
- If user says "modify", adjust the plan and present again

## <HARD-GATE> No Code Without Design

**Writing code without an approved plan is FORBIDDEN.**

This is not a suggestion. This is a gate. No exceptions for "simple" changes.

### Anti-Pattern: "This Is Too Simple To Need A Plan"

Every shortcut that skipped planning has led to:
- Rework when assumptions were wrong
- Scope creep when edge cases appeared
- Wasted context when the approach didn't fit

### Mandatory Checklist

ALL boxes must be checked before writing any code:

- [ ] **EXPLORE**: Read all relevant source files (not just the ones you think are relevant)
- [ ] **CLARIFY**: All ambiguous requirements resolved with the user
- [ ] **PLAN**: Step-by-step plan written with file paths, expected changes, and verification steps
- [ ] **APPROVE**: User has explicitly said "yes", "proceed", "approved", or equivalent

If any box is unchecked, **STOP**. Go back to the unchecked step.

### Rationalization Prevention

| Rationalization | Why It's Wrong | What To Do |
|-----------------|----------------|------------|
| "Simple change, just one file" | One-file changes break other files | Plan it — takes 30 seconds |
| "I already know how to do this" | You know how YOU would do it, not how THIS codebase does it | EXPLORE first |
| "Only one way to do this" | There are always alternatives worth considering | List at least 2 approaches |
| "Planning is overkill here" | The cost of planning is minutes; the cost of rework is hours | Plan it anyway |

</HARD-GATE>
