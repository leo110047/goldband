Perform a comprehensive health check of the goldband installation.

## Instructions

Run the following checks in order and produce a structured report.

### 0. Plugin Data Probe

Before relying on persistent plugin state, run:

`node skills/global/claude-config-verification/scripts/probe-plugin-data.js`

Report:
- whether `${CLAUDE_PLUGIN_DATA}` is present
- whether the resolved path is writable/readable
- whether the runtime had to fall back to temp storage

### 1. Symlink Checks

Check these paths exist and point to valid targets:
- `~/.claude/skills` → either:
  - legacy symlink to this repo's `skills/global`, OR
  - managed directory with `.goldband-profile` file and per-skill symlinks
- `~/.claude/commands` → should point to this repo's `commands`
- `~/.claude/contexts` → should point to this repo's `contexts`
- `~/.claude/rules` → should point to this repo's `rules`
- `~/.claude/hooks/scripts` → should point to this repo's `hooks/scripts`

For each: report OK if target is valid, WARNING if exists but target is ambiguous, ERROR if missing.

### 2. Hook Checks

Check `~/.claude/settings.json` for hooks configuration:
- Count total hooks defined (PreToolUse + PostToolUse + Stop + Notification)
- For each hook, verify the script file referenced in `command` exists
- Verify:
  - PreToolUse has exactly one router command (`hook-router.js`)
  - PostToolUse has one router command + async worker commands (`post-edit-worker.js --task format/typecheck`)
  - Stop hook exists and does not rely on matcher filtering
- Report OK with count if all scripts found, WARNING for missing scripts

### 3. Skill Checks

For each installed skill under `~/.claude/skills`:
- Verify SKILL.md exists
- Check YAML frontmatter has `name` and `description` fields
- Count lines — report WARNING if over 500 lines
- Check for reference/ directory and verify linked files exist in SKILL.md
- Report total skill count

Also report profile metadata when `.goldband-profile` exists:
- active profile (`core` / `dev` / `full`)
- installed skill count

### 4. Context Checks

Count .md files in the contexts directory. Verify each is non-empty. Report count.

### 5. Rule Checks

Count .md files in the rules directory. Verify each is non-empty. Report count.

### 6. JSON Validation

Validate these JSON files have correct syntax:
- `hooks/hooks.json`
- `skills/global/skill-rules.json`
- `.claude-plugin/plugin.json`

Use `cat FILE | python3 -c "import sys,json; json.load(sys.stdin); print('OK')"` or similar.

## Output Format

```
╔════════════════════════════════════════╗
║  goldband Health Check                 ║
╚════════════════════════════════════════╝

Symlinks:
  [OK]      skills profile: dev (12 個)
  [OK]      skills links point to /path/to/repo/skills/global/*
  [OK]      commands → /path/to/repo/commands
  ...

Plugin Data:
  [OK]      CLAUDE_PLUGIN_DATA available at /path/to/data
  [WARNING] using temp fallback at /tmp/claude-config-verification

Hooks:
  [OK]      8 hooks configured in settings.json
  [OK]      All hook scripts exist

Skills:
  [OK]      14 skills found
  [WARNING] backend-patterns/SKILL.md: 520 lines (>500)
  ...

Contexts:
  [OK]      4 contexts found

Rules:
  [OK]      3 rules found

JSON Validation:
  [OK]      hooks.json — valid
  [OK]      skill-rules.json — valid

Summary: X OK, Y WARNING, Z ERROR
```

If the `quick` argument is provided, only run checks 1 (Symlinks) and 2 (Hooks).
