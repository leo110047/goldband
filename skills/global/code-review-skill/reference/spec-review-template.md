# Spec Compliance Review Template

## Core Principle

```
DO NOT TRUST THE REPORT. READ THE ACTUAL CODE.
```

A spec review is not a checklist exercise. It is a verification act. For every requirement, you must:
1. Find the implementation in actual source code
2. Read the implementation
3. Judge whether it fulfills the requirement — not "looks like it does", but actually does

## Requirements Compliance Table

Use this template for every spec review:

```markdown
# Spec Compliance Review

**Spec Source**: [file path or description]
**Review Date**: [date]
**Reviewer**: Claude (automated)

## Compliance Summary

| Status | Count |
|--------|-------|
| Implemented | X |
| Partial | X |
| Missing | X |
| Incorrect | X |
| Extra | X |

## Detailed Findings

| # | Requirement | Status | Location | Notes |
|---|-------------|--------|----------|-------|
| 1 | [requirement text] | Implemented | `src/foo.ts:42` | [verification notes] |
| 2 | [requirement text] | Partial | `src/bar.ts:15` | [what's missing] |
| 3 | [requirement text] | Missing | — | [no implementation found] |
| 4 | [requirement text] | Incorrect | `src/baz.ts:88` | [how it deviates] |
| 5 | — | Extra | `src/qux.ts:12` | [unrequested implementation] |

## Verdict

[PASS / FAIL / CONDITIONAL PASS]

### Blocking Issues (must fix)
- [list]

### Non-Blocking Issues (should fix)
- [list]
```

## Status Definitions

| Status | Meaning | Action Required |
|--------|---------|-----------------|
| **Implemented** | Requirement fully satisfied by code | None |
| **Partial** | Some aspects implemented, others missing | Must complete |
| **Missing** | No implementation found | Must implement |
| **Incorrect** | Implementation exists but doesn't match requirement | Must fix |
| **Extra** | Code exists that wasn't in the spec | Evaluate: intentional or scope creep? |

## Verification Principles

### 1. Every Requirement Gets a Location

If you cannot point to a specific `file:line` where a requirement is implemented, it is either **Missing** or you haven't searched thoroughly enough. Search again before marking Missing.

### 2. "Implemented" Means Correct, Not Just Present

Code that addresses a requirement but does it wrong is **Incorrect**, not Implemented. Check:
- Does it handle the specified inputs?
- Does it produce the specified outputs?
- Does it handle edge cases mentioned in the spec?

### 3. Extra Code Is a Signal

Unrequested code may indicate:
- Misunderstanding of the spec (mark the related requirement as Incorrect)
- Scope creep (flag for discussion)
- Necessary scaffolding (document as intentional)

### 4. Partial Is Not Good Enough

Partial implementations are the most dangerous — they look done but aren't. For each Partial finding, explicitly list what is present and what is missing.

## Usage Guide

1. Read the entire spec/requirements document first
2. Number each discrete requirement
3. For each requirement, search the codebase (Grep/Glob) for relevant implementation
4. Read the implementation code (not just the function name — the actual logic)
5. Fill in the compliance table
6. Summarize blocking vs non-blocking issues
7. Deliver verdict
