# goldband Repository Instructions

This repository manages configuration for both Claude Code and Codex.

## Primary Goal

Keep shared engineering policy portable across tools while keeping tool-specific adapters explicit.

## When Editing This Repo

- Keep Claude assets (`hooks/`, `commands/`, `rules/`, `.claude-plugin/`) and Codex assets (`codex/`, `.codex/`, `AGENTS.md`) in sync when a shared policy changes.
- Do not claim dual-tool parity until the installer, README, and inventory documentation all reflect the same change.
- Use the shared, portable skills when possible. Treat Claude-specific hooks and Codex-specific rules as adapters, not as sources of truth.
- When changing Claude hook or installer behavior, run the Claude config verification workflow before claiming the change is safe.
- When changing Codex rules or global templates, validate rule syntax with `codex execpolicy check` and verify installer output under a temp `HOME`.

## Design Guidance

- For UI, frontend, and visual work in this repo, treat [`DESIGN.md`](DESIGN.md) as the project design source of truth.
- Before implementing new UI, explicitly decide typography, color, spacing, layout, and motion rather than jumping straight to components.
- Prefer the `frontend-design` skill for UI generation when available.
- Every visual choice follows `DESIGN.md` or an explicit product decision; default styling, trend styling, and layouts without a focal point are not decisions.

## Preferred Portable Skills and Workflow Entrypoints

If the portable goldband skills are installed for Codex, prefer:

- `$evidence-based-coding`
- `$file-search`
- `$implementation-contracts`
- `$testing-strategy`
- `$performance-optimization`

For full review, investigation, planning, security review, design review, QA,
benchmarking, and skill-authoring flows, prefer the workflow selectors:
Claude uses `/goldband <capability> <action>`; Codex uses `$goldband <capability> <action>`. `/goldband-plan` remains the
direct planning command. The matching portable skills define shared policy
and defer full workflows to these selectors.

Use repo-specific skills only when the task is actually about maintaining goldband itself.
