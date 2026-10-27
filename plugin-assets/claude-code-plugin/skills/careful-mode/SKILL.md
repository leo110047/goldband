---
name: careful-mode
description: |
  Use before running destructive or prod-facing CLI commands. This skill
  enables an on-demand hook mode that blocks recursive force deletes, Git
  force-push and hard reset, Terraform destroy, kubectl delete, Helm
  uninstall, and destructive SQL through database clients until you disable it.
allowed-tools:
  - Read
  - Grep
  - Bash
disable-model-invocation: true
---

# Careful Mode

## When to Use

- Production infrastructure or shared environments.
- Destructive operations with expensive rollback.
- Temporary high-friction protection without making all hooks stricter.

## Script

Run the scripts from this skill's directory, keeping the prefix as written.
A plugin install substitutes its data directory, which the shell does not
carry, so the state lands where the hooks read it. Outside a plugin the
prefix is empty and the default data directory applies.

- `CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" node scripts/careful-mode.js enable`:
  activates `careful-mode` for the current Claude session.
- `CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" node scripts/careful-mode.js status`:
  reports activation, state location, and armed guards.
- `CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" node scripts/careful-mode.js disable`:
  deactivates the mode.

Flags: `--session <id>` targets another session; `--json` prints
machine-readable output.

## Guarded Operations

While active, the `PreToolUse` router blocks the Bash operations defined by
`CAREFUL_MODE_GUARDS` in `hooks/scripts/lib/hook-router/careful-mode-rules.js`.
That module is the authoritative list; the description names each guard's
`summary`, and the hook router coverage check fails when one is missing.

## Gotchas

- The guards are a focused blocklist, not a production policy engine.
- Disable the mode when the risky window ends.
- Mode state is session-scoped; check `status` before claiming it is armed or
  disabled.
- A command without the prefix writes state the plugin hooks do not read.

## Completion Check

Before claiming the risky window was guarded, report:

- The command used to enable the mode.
- The `status` evidence before the risky operation.
- Whether any guarded command was blocked or allowed.
- The `status` evidence after disabling the mode.
