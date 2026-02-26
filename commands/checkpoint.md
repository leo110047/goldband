---
description: Create, verify, pause, or resume workflow checkpoints. Supports cross-session state persistence.
---

# Checkpoint Command

Create or verify a checkpoint in your workflow.

## Usage

`/checkpoint [create|verify|list] [name]`

## Create Checkpoint

When creating a checkpoint:

1. Run `/verify quick` to ensure current state is clean
2. Create a git stash or commit with checkpoint name
3. Log checkpoint to `.claude/checkpoints.log`:

```bash
echo "$(date +%Y-%m-%d-%H:%M) | $CHECKPOINT_NAME | $(git rev-parse --short HEAD)" >> .claude/checkpoints.log
```

4. Report checkpoint created

## Verify Checkpoint

When verifying against a checkpoint:

1. Read checkpoint from log
2. Compare current state to checkpoint:
   - Files added since checkpoint
   - Files modified since checkpoint
   - Test pass rate now vs then
   - Coverage now vs then

3. Report:
```
CHECKPOINT COMPARISON: $NAME
============================
Files changed: X
Tests: +Y passed / -Z failed
Coverage: +X% / -Y%
Build: [PASS/FAIL]
```

## List Checkpoints

Show all checkpoints with:
- Name
- Timestamp
- Git SHA
- Status (current, behind, ahead)

## Workflow

Typical checkpoint flow:

```
[Start] --> /checkpoint create "feature-start"
   |
[Implement] --> /checkpoint create "core-done"
   |
[Test] --> /checkpoint verify "core-done"
   |
[Refactor] --> /checkpoint create "refactor-done"
   |
[PR] --> /checkpoint verify "feature-start"
```

## Pause (Save Session State)

`/checkpoint pause [name]`

Create a continuation file for resuming work in a new session.

1. Create `.claude/continue-here.md` with the following sections:

```markdown
# Continue Here: [name or auto-generated]

## Current State
[What phase/step are we in right now]

## Completed Work
- [Bullet list of what's been done, with file paths]

## Remaining Work
- [Bullet list of what's left to do]

## Decisions Made
- [Key decisions and their rationale]

## Blockers
- [Any blocking issues encountered]

## Context
- [Branch name, relevant PRs, key file paths]

## Next Action
[The exact next step to take when resuming]
```

2. Commit the file (if in a git repo): `git add .claude/continue-here.md && git commit -m "chore: checkpoint pause — [name]"`
3. Report: "Session state saved to `.claude/continue-here.md`. Resume with `/checkpoint resume`."

## Resume (Restore Session State)

`/checkpoint resume`

1. Read `.claude/continue-here.md`
2. Present a concise status summary:
```
RESUMING: [name]
========================
Completed: X items
Remaining: Y items
Next action: [description]
```
3. Ask: "Ready to continue from the next action?"

## Arguments

$ARGUMENTS:
- `create <name>` - Create named checkpoint
- `verify <name>` - Verify against named checkpoint
- `list` - Show all checkpoints
- `clear` - Remove old checkpoints (keeps last 5)
- `pause [name]` - Save session state for cross-session resume
- `resume` - Restore session state from pause file
