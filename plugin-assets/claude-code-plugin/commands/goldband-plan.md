---
description: Restate requirements, pressure-test the direction, and create a step-by-step implementation plan. WAIT for user CONFIRM before touching any code.
---

# Plan Command

## Programmatic runtime entrypoint

The runtime contract for this command lives in `goldband-loop/workflows/`.
Use the programmatic path for mock smoke tests and structured evidence:

```bash
cd goldband-loop && bun run workflows/run.ts plan create --mode mock
```

The runtime reads this command source and writes step evidence to
`${GOLDBAND_HOME:-$HOME/.goldband}/workflow-runs/plan.jsonl`. Live planning
follows the command flow below.

This command creates the implementation plan before any code is written and owns
its bounded engineering review; a draft is not routed through a second public
action.

## Process

1. **Restate Requirements** - Clarify what needs to be built
2. **Explore Codebase** - Read relevant files to understand current architecture
3. **State the Direction** - Name the smallest sufficient approach and why it covers the current need, root-cause class, and required safety boundaries
4. **Run a Pre-Mortem** - Surface failure modes, early warning signals, fallback path, and the best alternative
5. **Break Down into Phases** - Specific, actionable steps with dependencies
6. **Assess Risks** - Surface implementation issues and blockers
7. **Estimate Complexity** - High / Medium / Low
8. **WAIT for Confirmation** - MUST receive user approval before proceeding

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

## Decision Check
- Recommendation: [recommended direction]
- Why Now: [why this direction fits the current constraints]
- Current Need or Risk: [requirement, root-cause class, or required boundary]
- Smallest Sufficient Option: [least permanent mechanism that fully covers it]
- Permanent Cost: [ongoing operational or maintenance cost introduced]
- Evidence for Heavier Mechanism: [named gap and current evidence, or "not justified"]
- Assumptions: [what must hold true]
- Best Alternative: [next-best option] — choose it when [switch criteria]

## Pre-Mortem
- Failure Mode: [how this plan can fail]
- Early Warning Signal: [what to watch for]
- Fallback Path: [what to do if the failure signal appears]
- Unknown to Verify: [open question that still needs evidence]

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

- Within this `/goldband-plan` command flow, do not write code until the user explicitly
  confirms with "yes" or "proceed"
- Always verify assumptions with actual code (Read, Grep, Glob) before planning
- For architecture or direction-setting work, choose the smallest sufficient solution that fully covers the current requirement, root-cause class, ownership, and required safety boundaries; this is not permission for a symptom patch, fallback, special case, or duplicated authority
- Recommend a heavier permanent mechanism only when current evidence names the requirement, reachable failure path, or boundary invariant the smaller option cannot cover, and surface the ongoing operational or maintenance cost
- If the plan is complex, risky, or cross-module, include the engineering review before implementation
- If user says "modify", adjust the plan and present again
