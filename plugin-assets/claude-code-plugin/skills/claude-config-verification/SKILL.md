---
name: claude-config-verification
description: |
  Use when modifying the goldband config repo across Claude Code or Codex
  assets (`skills/`, `hooks/`, `commands/`, `rules/`, `claude/`,
  `.claude-plugin/`, `.codex/`, `codex/`, or install scripts) and you need a
  concrete health check before claiming the change is safe.

  Best fit for config repositories that need JSON/TOML validation, hook
  reference checks, Codex rule validation, plugin-data probing, and optional
  router replay.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# goldband Config Verification

## When to Use

- After changing hook router logic or hook policies
- After changing Claude/Codex global templates, execpolicy rules, or portable-skill install logic
- After editing `hooks/hooks.json`, `skill-rules.json`, or `.claude-plugin/plugin.json`
- After editing `.codex/config.toml`, `codex/config.toml`, `codex/rules/default.rules`, or `AGENTS.md`
- After adding/removing skills, commands, or rules
- Before claiming the goldband Claude/Codex config repo is ready to ship
- Before depending on `${CLAUDE_PLUGIN_DATA}` for persistent plugin state

## Scripts

Scripts live next to this skill in `./scripts/`. From the goldband repo root,
use `skills/global/claude-config-verification/scripts/...`.

- `./scripts/probe-plugin-data.js`
  - Confirms whether `${CLAUDE_PLUGIN_DATA}` is available in the current runtime
  - Verifies the target directory can be created, written, and read back
  - Falls back to temp storage when the current execution context does not expose plugin data
- `./scripts/verify-claude-config.js`
  - Validates JSON and TOML files
  - Checks `SKILL.md` frontmatter and linked reference files
  - Verifies hook script references in `hooks/hooks.json`
  - Verifies required Codex repo files exist
  - Runs `codex execpolicy check` against `codex/rules/default.rules` when the `codex` CLI is available
  - Records a verification history entry in stable plugin data when available
- `./scripts/verify-claude-config.js --router-replay`
  - Runs the hook router replay harness when router behavior changed

## Gotchas

- `${CLAUDE_PLUGIN_DATA}` may be absent outside plugin hook execution; scripts then fall back to temp storage.
- Stale hook references and broken reference links block shipping as much as invalid JSON.
- Do not claim Codex support is safe if `codex/rules/default.rules` has not been syntax-checked against real commands.
- Do not claim router changes are safe without replay when router policy code changed.
- Do not add a new global skill without also updating installer profiles and inventory documentation.
- Do not change shared policy text without checking both the Claude adapter (`rules/`, `hooks/`) and the Codex adapter (`AGENTS.md`, `codex/rules/`).
- `SKILL.md` names every script and asset the skill bundles.

## Memory and Reports

- Verification history is appended to `history.jsonl`
- Storage: `${CLAUDE_PLUGIN_DATA}/claude-config-verification/`, else the system temp directory
- Report template: `assets/verification-report-template.md`

## Suggested Workflow

1. Run `node skills/global/claude-config-verification/scripts/probe-plugin-data.js`
2. Run `node skills/global/claude-config-verification/scripts/verify-claude-config.js`
3. If hooks/router changed, run `node skills/global/claude-config-verification/scripts/verify-claude-config.js --router-replay`
4. Summarize results using `assets/verification-report-template.md`

## Completion Check

Before claiming config verification is complete, report:

- Which script was run and with what target surface.
- Whether the report file or history entry was produced.
- Any missing binary, plugin data path, runtime state, or install surface.
- Whether the evidence proves full parity or only partial verification.
