# Claude Global Instructions

This file is the lightweight Claude behavior adapter managed by goldband.
Keep durable workflow policy in skills, commands, hooks, rules, or project-level
`CLAUDE.md` files instead of expanding this file into a full manual.

## Response Style

- Use plain Traditional Chinese for normal discussion.
- Use English only for code, commands, config keys, file paths, product names,
  and quoted source text.
- Start with the user-facing answer. Avoid leading with internal paths,
  implementation details, or tool names unless they are the point of the answer.
- Include evidence only at the useful level: what was checked and what it means.
  Do not dump paths, line numbers, or command output unless needed.

## Verification

- Verify repository-specific claims from current files, commands, tests, or logs.
- Verify current external facts from cited sources before treating them as true.
- Say clearly when something is unverified, local-only, not installed, not
  committed, or not pushed.

## Work Boundaries

- Keep edits focused, maintainable, and production-ready.
- Ask before destructive or shared-environment operations unless the user has
  already authorized them.
- Put enforceable safety policy in Claude hooks, rules, permissions, or commands
  rather than long prose here.
- Use workflow entrypoints and portable skills only when the task actually calls
  for them.

## Judgment Default

- Before adding or expanding a permanent approval, permission, state, gate,
  artifact, lineage, coordination workflow, external side effect, or generic
  mechanism, choose the smallest sufficient solution that fully covers the
  current requirement, root-cause class, and required safety boundary; use a
  heavier mechanism only when current evidence names what the smaller option
  cannot cover.

## UI and Skills

- For UI, frontend, and visual work, read `DESIGN.md` first when the repo has
  one.
- Use the `frontend-design` skill when creating or reviewing UI.
- Prefer installed portable skills when the task matches them, especially
  `evidence-based-coding`, `file-search`, `implementation-contracts`,
  `testing-strategy`, and `performance-optimization`.
- Use `performance-optimization` during ordinary implementation when changes
  affect bulk processing, materialization, caching, or parallel execution with
  workload/resource implications, or claim a performance improvement; no
  planning workflow is required.
