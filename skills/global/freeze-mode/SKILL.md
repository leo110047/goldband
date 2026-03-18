---
name: freeze-mode
description: |
  Use when you need a read-only investigation window for production or sensitive
  systems and want Claude blocked from file edits plus non-read-only Bash commands.
  Best fit for incident triage, audits, or "look but do not change" sessions.
allowed-tools:
  - Read
  - Grep
  - Bash
---

# Freeze Mode

## When to Use

- During production debugging when you need to inspect without mutating anything
- During audits, incident review, or evidence collection windows
- When a task should stay read-only until a human explicitly lifts the freeze
- When `careful-mode` is too narrow and you want stronger, broader safety friction

## Script

- `node scripts/freeze-mode.js enable`
  - Activates `freeze-mode` for the current Claude session
- `node scripts/freeze-mode.js status`
  - Shows whether the mode is active, where state is stored, and which protections apply
- `node scripts/freeze-mode.js disable`
  - Turns the mode off after the read-only window ends

Optional flags:
- `--session <id>` to inspect or toggle another session explicitly
- `--json` for machine-readable output

## Protections

While active, the `PreToolUse` router:

- Blocks `Edit` and `Write` tool calls
- Allows only explicitly allowlisted read-only Bash commands such as `git status|diff|log|show|rev-parse`, `rg`, `grep`, `ls`, `cat`, `head`, and `tail`
- Blocks shell chaining, pipes, and redirections because they are harder to classify as read-only

## Gotchas

- Do not use this as a substitute for change control. It creates friction; it does not replace approvals or runbooks.
- Do not expect arbitrary shell one-liners to pass. `freeze-mode` is intentionally conservative and favors false positives over accidental mutation.
- Do not expect whole command families like `sed`, `awk`, `find`, or `sort` to pass. They support mutating forms and are intentionally excluded.
- Do not leave it enabled while implementing fixes; it will block normal editing and create noise.
- Do not claim a session was read-only without checking `status`; state is session-scoped and can differ across tabs/sessions.
- Do not assume plugin data is available in every invocation path. Claude Code `2.1.78` plugin sessions were live-verified to expose `${CLAUDE_PLUGIN_DATA}`, but standalone script execution can still fall back to temp storage.

## Suggested Workflow

1. Run `node scripts/freeze-mode.js enable`
2. Confirm with `node scripts/freeze-mode.js status`
3. Perform the investigation window with read-only tools
4. Run `node scripts/freeze-mode.js disable`
5. Confirm the mode is off before starting any edits or deploy actions
