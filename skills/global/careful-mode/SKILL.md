---
name: careful-mode
description: |
  Use before running destructive or prod-facing CLI commands such as `rm -rf`,
  `git push --force`, `git reset --hard`, `terraform destroy`, `kubectl delete`,
  `helm uninstall`, or destructive SQL. This skill enables an on-demand hook
  mode that blocks high-risk Bash operations until you disable it.
allowed-tools:
  - Read
  - Grep
  - Bash
---

# Careful Mode

## When to Use

- Before touching production infrastructure or shared environments
- Before any destructive shell operation where rollback is expensive
- Before force-push, hard reset, destroy, delete, uninstall, or destructive SQL
- When you want temporary high-friction protection without making all hooks stricter

## Script

- `node scripts/careful-mode.js enable`
  - Activates `careful-mode` for the current Claude session
- `node scripts/careful-mode.js status`
  - Shows whether the mode is active, where state is stored, and which guards are armed
- `node scripts/careful-mode.js disable`
  - Turns the mode off after the risky work is finished

Optional flags:
- `--session <id>` to inspect or toggle another session explicitly
- `--json` for machine-readable output

## Guarded Operations

While active, the `PreToolUse` router blocks these Bash patterns:

- `rm -rf` and equivalent recursive-force deletes
- `git push --force`, `--force-with-lease`, or `-f`
- `git reset --hard`
- `terraform destroy`
- `kubectl delete`
- `helm uninstall`
- destructive SQL (`DROP` / `TRUNCATE`) when sent through common DB CLIs

## Gotchas

- Do not enable this mode and assume it catches every dangerous operation. It is a focused blocklist, not a full prod policy engine.
- Do not leave the mode enabled after the risky window ends; unnecessary friction will eventually train people to ignore it.
- Do not rely on memory of the mode state. Run `status` before claiming it is armed or disabled.
- Do not assume `${CLAUDE_PLUGIN_DATA}` exists in every invocation path. Claude Code `2.1.78` plugin sessions were live-verified to expose it, but standalone script execution can still fall back to temp storage.
- Do not duplicate the blocked-command list in other docs or scripts; the hook rule module is the source of truth.

## Suggested Workflow

1. Run `node scripts/careful-mode.js enable`
2. Confirm with `node scripts/careful-mode.js status`
3. Perform the risky operation window
4. Run `node scripts/careful-mode.js disable`
5. Confirm the mode is off before resuming normal work
