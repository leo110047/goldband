---
name: claude-config-verification
description: |
  Use when modifying a Claude Code config/plugin repo with `skills/`, `hooks/`,
  `commands/`, `contexts/`, `rules/`, `.claude-plugin/`, or install scripts and
  you need a concrete health check before claiming the change is safe.

  Best fit for config repositories that need JSON/frontmatter validation,
  hook reference checks, plugin-data probing, and optional router replay.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Claude Config Verification

## When to Use

- After changing hook router logic, hook policies, or worker behavior
- After editing `hooks/hooks.json`, `skill-rules.json`, or `.claude-plugin/plugin.json`
- After adding/removing skills, commands, contexts, or rules
- Before claiming a Claude Code config/plugin repo is ready to ship
- Before depending on `${CLAUDE_PLUGIN_DATA}` for persistent plugin state

## Scripts

- `scripts/probe-plugin-data.js`
  - Confirms whether `${CLAUDE_PLUGIN_DATA}` is available in the current runtime
  - Verifies the target directory can be created, written, and read back
  - Falls back to temp storage when the runtime does not expose plugin data
- `scripts/verify-claude-config.js`
  - Validates JSON files
  - Checks `SKILL.md` frontmatter and linked reference files
  - Verifies hook script references in `hooks/hooks.json`
  - Records a verification history entry in stable plugin data when available
- `scripts/verify-claude-config.js --router-replay`
  - Runs the hook router replay harness when router behavior changed

## Gotchas

- Do not assume `${CLAUDE_PLUGIN_DATA}` exists just because the latest article mentions it. Probe the runtime first.
- Do not stop at JSON syntax validation; stale hook references and broken reference links are equally shipping blockers.
- Do not claim router changes are safe without replay when policy or worker code changed.
- Do not add a new global skill without also updating installer profiles and inventory documentation.
- Do not add scripts or assets to a skill and forget to mention them in `SKILL.md`; undiscoverable files are almost as bad as missing files.

## Memory and Reports

- Verification history is appended to `history.jsonl`
- Preferred storage: `${CLAUDE_PLUGIN_DATA}/claude-config-verification/`
- Fallback storage: system temp directory
- Report template: `assets/verification-report-template.md`

## Suggested Workflow

1. Run `node scripts/probe-plugin-data.js`
2. Run `node scripts/verify-claude-config.js`
3. If hooks/router changed, run `node scripts/verify-claude-config.js --router-replay`
4. Summarize results using `assets/verification-report-template.md`
