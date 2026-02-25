Perform a comprehensive health check of the Claude Code Config installation.

## Instructions

Run the following checks in order and produce a structured report.

### 1. Symlink Checks

Check these symlinks exist and point to valid targets:
- `~/.claude/skills` → should point to this repo's `skills/global`
- `~/.claude/commands` → should point to this repo's `commands`
- `~/.claude/contexts` → should point to this repo's `contexts`
- `~/.claude/rules` → should point to this repo's `rules`
- `~/.claude/hooks/scripts` → should point to this repo's `hooks/scripts`

For each: report OK if symlink exists and target is valid, WARNING if exists but not a symlink, ERROR if missing.

### 2. Hook Checks

Check `~/.claude/settings.json` for hooks configuration:
- Count total hooks defined (PreToolUse + PostToolUse + Stop)
- For each hook, verify the script file referenced in `command` exists
- Report OK with count if all scripts found, WARNING for missing scripts

### 3. Skill Checks

For each directory under the skills symlink target:
- Verify SKILL.md exists
- Check YAML frontmatter has `name` and `description` fields
- Count lines — report WARNING if over 500 lines
- Check for reference/ directory and verify linked files exist in SKILL.md
- Report total skill count

### 4. Context Checks

Count .md files in the contexts directory. Verify each is non-empty. Report count.

### 5. Rule Checks

Count .md files in the rules directory. Verify each is non-empty. Report count.

### 6. JSON Validation

Validate these JSON files have correct syntax:
- `hooks/hooks.json`
- `skills/global/skill-rules.json`

Use `cat FILE | python3 -c "import sys,json; json.load(sys.stdin); print('OK')"` or similar.

## Output Format

```
╔════════════════════════════════════════╗
║  Claude Code Config Health Check       ║
╚════════════════════════════════════════╝

Symlinks:
  [OK]      skills → /path/to/repo/skills/global
  [OK]      commands → /path/to/repo/commands
  ...

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
