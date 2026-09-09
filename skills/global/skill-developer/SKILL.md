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

This is a thin shared-policy entrypoint. Full skill creation and extraction
belongs in the host-native `skill-creator` skill when installed so Claude and Codex do not carry
duplicate skill-scaffold tooling in portable skills.

## When to Use

- Creating, merging, or editing `skills/global/*/SKILL.md`.
- Changing trigger descriptions or `skill-rules.json`.
- Moving detail into `reference/`, `examples/`, `assets/`, or `scripts/`.
- Adding hook-backed skill suggestions.
- Replacing ad hoc local workflow notes with a reusable skill.

## Workflow Handoff

Use the host-native `skill-creator` skill when installed for new skills, scaffold
generation, workflow extraction, or larger skill refactors.

Use this skill directly only for small metadata or trigger changes, or when
the creator is not installed.

## Gotchas

- Do not add broad trigger descriptions that activate for every task in the
  domain. Name the positive and negative trigger boundary.
- Do not put long reference material in `SKILL.md`; keep it focused and use
  references only when progressive disclosure genuinely helps.
- Do not add scripts without mentioning when to run them from `SKILL.md`.
- Do not change hook suggestion behavior without checking
  `hooks/scripts/lib/skill-activation/activation-rules.js`.
- Do not add, remove, or merge a global skill without updating installer profile
  docs and inventory.

## Required Checks

1. Read the target skill's current `SKILL.md` before editing.
2. Confirm the `name` matches the directory.
3. Confirm the `description` names when to use and when to defer.
4. Keep the main file at or below the `portableSkillBytes` prompt surface budget in `scripts/lib/prompt-surface-budget.mjs` (16 KiB by default); run `./scripts/check-skills.sh` to verify the hard gate.
5. Verify referenced files exist.
6. Run `./scripts/check-skills.sh`.
