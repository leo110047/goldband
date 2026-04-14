# goldband Repository Instructions

This repository manages configuration for both Claude Code and Codex.

## Primary Goal

Keep shared engineering policy portable across tools while keeping tool-specific adapters explicit.

## Shared Decision Guidance

- When proposing an approach, architecture direction, or technical recommendation, optimize for decision quality, failure containment, migration safety, and long-term maintainability, not minimal code delta.
- Treat solution direction, tradeoffs, prioritization, project health, refactoring direction, and maintenance strategy as recommendation work by default. In those cases, prefer the healthiest maintainable path, not the smallest patch.
- Recommendation-grade answers must include: the recommendation, why it fits now, the assumptions that must hold, the main failure modes, early warning signals, the best alternative and when it becomes better, and the unknowns that still need verification.
- Use this structure only when making an actual recommendation or directional judgment. Do not force it into every conversation.
- In debugging, stay evidence-first and root-cause-driven, but default to the healthiest complete fix once the defect is reproduced and scoped.
- Only prefer a narrower or temporary debugging fix when the user has explicitly stated that time pressure is the priority.

## When Editing This Repo

- Keep Claude assets (`hooks/`, `commands/`, `contexts/`, `rules/`, `.claude-plugin/`) and Codex assets (`codex/`, `.codex/`, `AGENTS.md`) in sync when a shared policy changes.
- Do not claim dual-tool parity until the installer, README, and inventory documentation all reflect the same change.
- Use the shared, portable skills when possible. Treat Claude-specific hooks and Codex-specific rules as adapters, not as sources of truth.
- When changing Claude hook or installer behavior, run the Claude config verification workflow before claiming the change is safe.
- When changing Codex rules or global templates, validate rule syntax with `codex execpolicy check` and verify installer output under a temp `HOME`.

## Preferred Portable Skills

If the portable goldband skills are installed for Codex, prefer:

- `$evidence-based-coding`
- `$systematic-debugging`
- `$file-search`
- `$planning-workflow`
- `$security-checklist`
- `$performance-optimization`

Use repo-specific skills only when the task is actually about maintaining goldband itself.
