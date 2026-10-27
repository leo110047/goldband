---
name: freeze-mode
description: |
  Use when you need a read-only investigation window for production or sensitive
  systems and want Claude blocked from non-read-only tools plus non-read-only Bash commands.
  Best fit for incident triage, audits, or "look but do not change" sessions.
allowed-tools:
  - Read
  - Grep
  - Bash
disable-model-invocation: true
---

# Freeze Mode

## When to Use

- Production debugging, audits, incident review, or evidence collection that
  must not mutate anything.
- Work that stays read-only until a human lifts the freeze.
- Situations where `careful-mode` guards too few operations.

## Script

Run the scripts from this skill's directory, keeping the prefix as written.
A plugin install substitutes its data directory, which the shell does not
carry, so the state lands where the hooks read it. Outside a plugin the
prefix is empty and the default data directory applies.

- `CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" node scripts/freeze-mode.js enable`:
  activates `freeze-mode` for the current Claude session.
- `CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" node scripts/freeze-mode.js status`:
  reports activation, state location, and protections.
- `CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" node scripts/freeze-mode.js disable`:
  deactivates the mode.

Flags: `--session <id>` targets another session; `--json` prints
machine-readable output.

## Protections

While active, the `PreToolUse` router:

- Blocks every non-Bash tool outside `READ_ONLY_TOOLS` in
  `hooks/scripts/lib/hook-router/pretool-policy.js`.
- Blocks every Bash command outside `FREEZE_MODE_ALLOWED_BASH` in
  `hooks/scripts/lib/hook-router/freeze-mode-rules.js`.
- Blocks shell chaining, command substitution, pipes, and redirections.

## Gotchas

- The mode adds friction; it does not replace change control, approvals, or
  runbooks.
- The allowlist favors false positives: command families with mutating forms
  are excluded entirely.
- Disable the mode before implementing fixes.
- Mode state is session-scoped; check `status` before claiming a session stayed
  read-only.
- A command without the prefix writes state the plugin hooks do not read.

## Completion Check

Before claiming the session stayed read-only, report:

- The command used to enable the mode.
- The `status` evidence before the investigation.
- The read-only evidence gathered.
- Any blocked tool or shell attempt.
- The `status` evidence after disabling the mode.
