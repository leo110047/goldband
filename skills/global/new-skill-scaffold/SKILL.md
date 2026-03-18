---
name: new-skill-scaffold
description: |
  Use when creating a new skill folder, refactoring a markdown-only skill into a
  folder-based skill, or scaffolding scripts/config/templates for a skill that
  needs progressive disclosure.

  Best fit when you want a repo-convention scaffold instead of hand-writing
  `SKILL.md`, `reference/`, `scripts/`, or `config.json` from scratch.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# New Skill Scaffold

## When to Use

- Before adding a new skill to this repo
- When an existing skill has outgrown a single `SKILL.md`
- When you want to start from repo conventions instead of a blank folder
- When you need a skill that ships with `scripts/`, `reference/`, or `config.json`

## Scripts

- `node scripts/create-skill.js --name my-skill --description "Use when ..."`
  - Creates a new skill folder with `SKILL.md` and `reference/README.md`
- `node scripts/create-skill.js --name my-skill --description "Use when ..." --scope unity`
  - Uses the `unity` root alias from this skill's `config.json`
- `node scripts/create-skill.js --name my-skill --description "Use when ..." --with-script --with-config`
  - Adds a script stub and a generated `config.json` stub to the new skill

## Setup

This skill uses `config.json` for local defaults:

- `defaultSkillRoot` - where new skills are created by default
- `rootAliases` - named roots such as `global` or `unity`
- `defaultAllowedTools` - frontmatter defaults for new skills
- `defaultReferenceDir` - detailed docs directory name
- `defaultIncludeScriptStub` / `defaultIncludeConfigStub` - scaffold defaults

If `config.json` is missing or incomplete, ask the user for the missing defaults before generating a scaffold.

## Gotchas

- Do not ship the generated scaffold without rewriting the placeholder trigger text and gotchas.
- Do not keep every detail in `SKILL.md`; move APIs, examples, and background into `reference/`.
- Do not add scripts or config files to a generated skill and forget to document them in the entrypoint.
- Do not use this scaffold as a justification for weak skill names. Keep names kebab-case and behavior-specific.
- Do not hardcode user-specific settings into generated skills; put team- or user-specific defaults into the skill's own `config.json`.

## Suggested Workflow

1. Confirm the target root (`global`, `unity`, or an explicit `--root`).
2. Generate the scaffold with `scripts/create-skill.js`.
3. Rewrite the generated `SKILL.md` so the description is trigger-first.
4. Move detailed docs into `reference/` and scripts into `scripts/`.
5. Update installer/catalog docs if the new skill should ship by default.
