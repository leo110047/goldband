---
name: skill-developer
description: |
  Use when creating, merging, or editing portable skills, trigger descriptions,
  progressive-disclosure layouts, or hook-backed skill tooling in this repo.

  Prefer the host-native `skill-creator` skill when installed for full scaffold,
  extraction, and reusable-workflow authoring.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Write
  - Edit
---

# Skill Developer

Shared skill-authoring policy. The host-native `skill-creator` skill, when
installed, owns skill creation and extraction.

## When to Use

- Creating, merging, or editing `skills/global/*/SKILL.md`.
- Changing trigger descriptions or `skill-rules.json`.
- Moving detail into `reference/`, `examples/`, `assets/`, or `scripts/`.
- Adding hook-backed skill suggestions.
- Replacing ad hoc local workflow notes with a reusable skill.

## Workflow Handoff

Use `skill-creator`, when installed, for new skills, scaffolds, workflow
extraction, and larger refactors. Use this skill alone for metadata or trigger
changes, or when `skill-creator` is not installed.

## Gotchas

- A trigger description names its positive and negative boundary; it does not
  activate for every task in the domain.
- `SKILL.md` stays focused; long material moves to references only when
  progressive disclosure helps.
- `SKILL.md` states when to run each bundled script.
- The host selects skills from the `description` field; keyword-suggestion
  prompt hooks are not added.
- Adding, removing, or merging a global skill updates installer profile docs and
  inventory.

## Required Checks

1. Read the target skill's current `SKILL.md` before editing.
2. Confirm the `name` matches the directory.
3. Confirm the `description` names when to use and when to defer.
4. Keep the main file within the `portableSkillBytes` budget in `scripts/lib/prompt-surface-budget.mjs`.
5. Verify referenced files exist.
6. Run `./scripts/check-skills.sh`.
