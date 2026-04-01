---
description: Comprehensive health check for the goldband installation and repo assets.
---

Perform a comprehensive health check of the goldband installation and repo assets.

## Instructions

Run the following checks in order and produce a structured report.

### 0. Plugin Data Probe

Before relying on persistent plugin state, run:

`node skills/global/claude-config-verification/scripts/probe-plugin-data.js`

Interpretation note:
- Claude Code `2.1.78` was live-verified to inject `${CLAUDE_PLUGIN_DATA}` inside a plugin `SessionStart` hook.
- Running this script directly from a normal shell still may report temp fallback, because standalone `node ...` execution is not guaranteed to run inside plugin context.

Report:
- whether `${CLAUDE_PLUGIN_DATA}` is present
- whether the resolved path is writable/readable
- whether the runtime had to fall back to temp storage

### 1. Claude Install Checks

Check these paths exist and point to valid targets:
- `~/.claude/skills` → either:
  - legacy symlink to this repo's `skills/global`, OR
  - managed directory with `.goldband-profile` file and per-skill symlinks
- `~/.claude/commands` → should point to this repo's `commands`
- `~/.claude/contexts` → should point to this repo's `contexts`
- `~/.claude/rules` → should point to this repo's `rules`
- `~/.claude/hooks/scripts` → should point to this repo's `hooks/scripts`
- `~/.claude/bin/goldband-self-update` → should exist
- `~/.claude/shell/goldband-launchers.sh` → should exist
- `~/.zshrc` → should contain the goldband shell launcher source block (`zsh` only)

For each: report OK if target is valid, WARNING if exists but target is ambiguous, ERROR if missing.

### 2. Codex Install Checks

Check these paths exist and point to valid targets:
- `~/.codex/AGENTS.md` → should point to this repo's `codex/AGENTS.md`
- `~/.codex/config.toml` → should point to this repo's `codex/config.toml`
- `~/.codex/rules` → should point to this repo's `codex/rules`
- `~/.agents/skills` → should be a managed directory with `.goldband-profile` and portable skill symlinks

Also report Codex profile metadata when `~/.agents/skills/.goldband-profile` exists:
- active profile (`core` / `full`)
- installed skill count

### 2.5. Optional Workflow Runtime Checks

If the workflow runtime is installed, also check:

- `~/.claude/skills/workflow`
  - `VERSION`
  - `setup`
  - `careful/SKILL.md`
  - `freeze/SKILL.md`
  - `review/SKILL.md`
  - `qa/SKILL.md`
- `~/.codex/skills/workflow`
  - `VERSION`
- generated Codex workflow wrappers under `~/.codex/skills/` (`goldband-*`)

If the workflow runtime is not installed, report INFO and continue.

If both goldband `careful-mode` / `freeze-mode` and workflow safety skills are available,
report a WARNING with integration guidance:
- use goldband for hard global guardrails
- use workflow skills for task-local guardrails

### 3. Hook Checks

Check `~/.claude/settings.json` for hooks configuration:
- Count total hooks defined (UserPromptSubmit + PreToolUse + PostToolUse + Stop + SubagentStop + Notification)
- For each hook, verify the script file referenced in `command` exists
- Verify:
  - UserPromptSubmit has exactly one skill suggestion command (`skill-activation-suggestions.js`)
  - PreToolUse has exactly one router command (`hook-router.js`)
  - PostToolUse has one router command + async worker commands (`post-edit-worker.js --task format/typecheck`)
  - Stop hook exists and does not rely on matcher filtering
  - SubagentStop exists for `general-purpose` and uses prompt-based completion review
- Report OK with count if all scripts found, WARNING for missing scripts

### 4. Skill Checks

For each installed Claude skill under `~/.claude/skills`:
- Verify `SKILL.md` exists
- Check YAML frontmatter has `name` and `description` fields
- Count lines — report WARNING if over 500 lines
- Check for `reference/` or `references/` links and verify linked files exist
- Report total skill count

Also report Claude profile metadata when `~/.claude/skills/.goldband-profile` exists:
- active profile (`core` / `dev` / `full`)
- installed skill count

### 5. Context Checks

Count `.md` files in the contexts directory. Verify each is non-empty. Report count.

### 6. Rule Checks

Count `.md` files in the rules directory. Verify each is non-empty. Report count.

### 7. Repo Syntax and Policy Validation

Validate these repo files:

JSON:
- `hooks/hooks.json`
- `skills/global/skill-rules.json`
- `.claude-plugin/plugin.json`

TOML:
- `.codex/config.toml`
- `codex/config.toml`

Required files:
- `AGENTS.md`
- `codex/AGENTS.md`
- `codex/rules/default.rules`

Codex execpolicy:
- `codex execpolicy check --rules codex/rules/default.rules -- git status --short` → should resolve to `allow`
- `codex execpolicy check --rules codex/rules/default.rules -- git push origin main` → should resolve to `prompt`
- `codex execpolicy check --rules codex/rules/default.rules -- rm README.md` → should resolve to `prompt`

If the `codex` CLI is unavailable, report a WARNING and skip the execpolicy step.

## Output Format

```
╔════════════════════════════════════════╗
║  goldband Health Check                 ║
╚════════════════════════════════════════╝

Plugin Data:
  [OK]      CLAUDE_PLUGIN_DATA available at /path/to/data
  [WARNING] using temp fallback at /tmp/claude-config-verification (expected outside plugin context or on older runtimes)

Claude Install:
  [OK]      skills profile: full (20 個)
  [OK]      commands → /path/to/repo/commands
  ...

Codex Install:
  [OK]      codex config → /path/to/repo/codex/config.toml
  [OK]      codex skills profile: full (15 個)
  ...

workflow:
  [OK]      Claude install — 0.x.y
  [OK]      careful/SKILL.md
  [OK]      freeze/SKILL.md
  [INFO]    Codex runtime not present

Hooks:
  [OK]      8 hooks configured in settings.json
  [OK]      All hook scripts exist

Skills:
  [OK]      20 installed Claude skills found
  [WARNING] backend-patterns/SKILL.md: 520 lines (>500)
  ...

Contexts:
  [OK]      4 contexts found

Rules:
  [OK]      4 rules found

Repo Validation:
  [OK]      hooks/hooks.json — valid
  [OK]      codex/config.toml — valid
  [OK]      codex/rules/default.rules: git status --short — allow
  ...

Summary: X OK, Y WARNING, Z ERROR
```

If the `quick` argument is provided, only run checks 1, 2, and 3.
